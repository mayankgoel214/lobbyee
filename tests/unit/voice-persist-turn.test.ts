// Unit tests for persistVoiceTurn (lib/voice/persist-turn.ts) — the idempotent
// write the voice worker drives. The real DB enforces two unique constraints
// (per-session idempotency_key, and (session_id, turn_index)); this fake
// reproduces both so we can lock in the behaviour that matters: a first write
// lays down the turn, a retry with the same key does NOT duplicate it, a write
// that crashed half-way is reconciled, a genuine slot clash surfaces as a
// collision (never silent corruption), and a coach-hint failure stays
// non-fatal.
import { describe, expect, it } from "vitest";
import type { MoodVector } from "@/lib/ai/mood";
import { persistVoiceTurn } from "@/lib/voice/persist-turn";

type Row = {
  sessionId: string;
  workspaceId: string;
  turnIndex: number;
  role: string;
  text: string;
  moodSnapshot?: MoodVector;
  idempotencyKey?: string | null;
};

function p2002(target: string[]): Error {
  const e = new Error("Unique constraint failed") as Error & {
    code: string;
    meta: { target: string[] };
  };
  e.code = "P2002";
  e.meta = { target };
  return e;
}

// Minimal stand-in for the RLS-scoped Prisma client — only the surface
// persistVoiceTurn touches, with the same per-session uniqueness the DB enforces.
function makeFakeDb() {
  const rows: Row[] = [];
  const db = {
    rows,
    message: {
      // biome-ignore lint/suspicious/noExplicitAny: test fake, shape is narrow
      findFirst: async ({ where, orderBy }: any): Promise<Row | null> => {
        let c = rows.filter((r) => r.sessionId === where.sessionId);
        if (where.idempotencyKey !== undefined) {
          return (
            c.find((r) => r.idempotencyKey === where.idempotencyKey) ?? null
          );
        }
        if (orderBy?.turnIndex === "desc") {
          c = [...c].sort((a, b) => b.turnIndex - a.turnIndex);
        }
        return c[0] ?? null;
      },
      // biome-ignore lint/suspicious/noExplicitAny: test fake, shape is narrow
      findUnique: async ({ where }: any): Promise<Row | null> => {
        const k = where.sessionId_turnIndex;
        if (!k) return null;
        return (
          rows.find(
            (r) => r.sessionId === k.sessionId && r.turnIndex === k.turnIndex,
          ) ?? null
        );
      },
      // biome-ignore lint/suspicious/noExplicitAny: test fake, shape is narrow
      create: async ({ data }: any): Promise<void> => {
        if (
          rows.some(
            (r) =>
              r.sessionId === data.sessionId && r.turnIndex === data.turnIndex,
          )
        ) {
          throw p2002(["session_id", "turn_index"]);
        }
        if (
          data.idempotencyKey != null &&
          rows.some(
            (r) =>
              r.sessionId === data.sessionId &&
              r.idempotencyKey === data.idempotencyKey,
          )
        ) {
          throw p2002(["session_id", "idempotency_key"]);
        }
        rows.push({ ...data });
      },
    },
    session: { update: async (): Promise<void> => {} },
  };
  // biome-ignore lint/suspicious/noExplicitAny: cast the narrow fake to ScopedDb
  return db as any;
}

const ids = {
  sessionId: "11111111-1111-1111-1111-111111111111",
  workspaceId: "22222222-2222-2222-2222-222222222222",
};
const mood: MoodVector = {
  frustration: 40,
  trust: 55,
  patience: 60,
  satisfaction: 50,
};
const turn = {
  idempotencyKey: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  userText: "Hi, I'd like to check in.",
  guestText: "Finally. I've been waiting twenty minutes.",
  mood,
  coachHint: "Acknowledge the wait before anything else.",
};

describe("persistVoiceTurn", () => {
  it("writes a fresh turn: user, guest (with mood), and coach rows in order", async () => {
    const db = makeFakeDb();
    const res = await persistVoiceTurn(db, ids, turn);

    expect(res).toEqual({ status: "written", guestTurnIndex: 1 });
    expect(db.rows).toHaveLength(3);
    expect(db.rows.map((r: Row) => [r.turnIndex, r.role])).toEqual([
      [0, "user"],
      [1, "guest"],
      [2, "coach"],
    ]);
    const guest = db.rows.find((r: Row) => r.role === "guest");
    expect(guest.moodSnapshot).toEqual(mood);
    expect(db.rows.find((r: Row) => r.role === "user").idempotencyKey).toBe(
      turn.idempotencyKey,
    );
  });

  it("continues numbering after an existing transcript", async () => {
    const db = makeFakeDb();
    db.rows.push(
      { ...ids, turnIndex: 0, role: "user", text: "a" },
      { ...ids, turnIndex: 1, role: "guest", text: "b" },
    );
    const res = await persistVoiceTurn(db, ids, turn);
    expect(res).toEqual({ status: "written", guestTurnIndex: 3 });
    expect(db.rows.find((r: Row) => r.idempotencyKey).turnIndex).toBe(2);
  });

  it("is idempotent: a retry with the same key does not duplicate", async () => {
    const db = makeFakeDb();
    await persistVoiceTurn(db, ids, turn);
    const before = db.rows.length;
    const res = await persistVoiceTurn(db, ids, turn);
    expect(res).toEqual({ status: "replayed", guestTurnIndex: 1 });
    expect(db.rows).toHaveLength(before); // no new rows
  });

  it("reconciles a turn whose guest/coach rows never landed", async () => {
    const db = makeFakeDb();
    // Simulate a crash right after the user row (with key) was written.
    db.rows.push({
      ...ids,
      turnIndex: 0,
      role: "user",
      text: turn.userText,
      idempotencyKey: turn.idempotencyKey,
    });
    const res = await persistVoiceTurn(db, ids, turn);
    expect(res).toEqual({ status: "replayed", guestTurnIndex: 1 });
    expect(db.rows.map((r: Row) => r.role).sort()).toEqual([
      "coach",
      "guest",
      "user",
    ]);
  });

  it("does not write a coach row when there is no hint", async () => {
    const db = makeFakeDb();
    const res = await persistVoiceTurn(db, ids, { ...turn, coachHint: null });
    expect(res.status).toBe("written");
    expect(db.rows.some((r: Row) => r.role === "coach")).toBe(false);
    expect(db.rows).toHaveLength(2);
  });

  it("reports a collision when a different turn already took the next index", async () => {
    const db = makeFakeDb();
    // Force the (session_id, turn_index) clash the way a concurrent worker
    // would: the user-row insert fails on the index constraint, not the key.
    db.message.create = async () => {
      throw p2002(["session_id", "turn_index"]);
    };
    const res = await persistVoiceTurn(db, ids, turn);
    expect(res).toEqual({ status: "collision" });
  });

  it("reports a collision (not silent corruption) when a foreign turn occupies the guest slot", async () => {
    const db = makeFakeDb();
    // Partial write left our user row at 0; a DIFFERENT turn then took slot 1.
    db.rows.push(
      {
        ...ids,
        turnIndex: 0,
        role: "user",
        text: turn.userText,
        idempotencyKey: turn.idempotencyKey,
      },
      { ...ids, turnIndex: 1, role: "user", text: "someone else's turn" },
    );
    const res = await persistVoiceTurn(db, ids, turn);
    // Guest slot (1) holds a foreign role → must NOT report success against it.
    expect(res).toEqual({ status: "collision" });
  });

  it("keeps the turn durable when the coach-hint write fails", async () => {
    const db = makeFakeDb();
    const realCreate = db.message.create;
    // Simulate a DB hiccup on the coach insert only.
    // biome-ignore lint/suspicious/noExplicitAny: test override
    db.message.create = async (arg: any) => {
      if (arg.data.role === "coach") throw new Error("db hiccup");
      return realCreate(arg);
    };
    const res = await persistVoiceTurn(db, ids, turn);
    expect(res).toEqual({ status: "written", guestTurnIndex: 1 });
    expect(db.rows.some((r: Row) => r.role === "coach")).toBe(false);
    expect(db.rows.filter((r: Row) => r.role === "user")).toHaveLength(1);
    expect(db.rows.filter((r: Row) => r.role === "guest")).toHaveLength(1);
  });
});
