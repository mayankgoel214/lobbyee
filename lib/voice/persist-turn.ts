// Persist one voice turn the Pipecat worker has already run (Phase 5, M2).
//
// Unlike the text path (lib/turn-engine), the worker does the AI itself — it
// streams the guest reply straight into TTS for low latency — so by the time
// it calls us the turn is DONE. This function only writes it down, mirroring
// the indexing + row shape the engine's textPersistence uses (user at N, guest
// at N+1 with the mood snapshot, optional coach hint at N+2).
//
// It is idempotent on `idempotencyKey` (the worker stamps the user row): a
// retried write replays instead of double-inserting, and a write that partially
// landed before a crash is reconciled to a complete turn on the retry.
//
// SECURITY: `db` MUST be the RLS-scoped client for the token's trainee
// (`dbForRequest(claims.userId)`), never `dbAdmin`. sessionId/workspaceId come
// from an RLS-validated read in the route, never from the worker's body.
import "server-only";
import type { MoodVector } from "@/lib/ai/mood";
import type { ScopedDb } from "@/lib/db/scoped";

export type VoiceTurnWrite = {
  /** Per-turn key the worker generates; anchors idempotency on the user row. */
  idempotencyKey: string;
  userText: string;
  guestText: string;
  mood: MoodVector;
  coachHint: string | null;
};

export type PersistTurnResult =
  | { status: "written" | "replayed"; guestTurnIndex: number }
  // A *different* turn already occupies the next index — a real concurrent
  // write (or a key collision we can't see across tenants). The route maps
  // this to 409 so the worker can refetch the snapshot and retry.
  | { status: "collision" };

function isP2002(e: unknown): boolean {
  return (e as { code?: string })?.code === "P2002";
}

function isKeyConflict(e: unknown): boolean {
  // Prisma reports the violated unique constraint in meta.target.
  const target = (e as { meta?: { target?: unknown } })?.meta?.target;
  const text = Array.isArray(target) ? target.join(",") : String(target ?? "");
  return text.includes("idempotency_key");
}

/** Create a message at `turnIndex`, swallowing the (sessionId, turnIndex)
 *  unique-constraint clash so reconciliation is safe to re-run. */
async function createIfAbsent(
  db: ScopedDb,
  data: {
    sessionId: string;
    workspaceId: string;
    turnIndex: number;
    role: "user" | "guest" | "coach";
    text: string;
    moodSnapshot?: MoodVector;
    idempotencyKey?: string;
  },
): Promise<void> {
  try {
    await db.message.create({ data });
  } catch (e) {
    if (!isP2002(e)) throw e;
    // Row already there (a prior attempt wrote it) — idempotent no-op.
  }
}

async function nextIndexFor(db: ScopedDb, sessionId: string): Promise<number> {
  const rows = await db.message.findMany({
    where: { sessionId },
    select: { turnIndex: true },
  });
  // Highest existing index + 1 — survives any earlier partial write, and never
  // depends on row order (mirrors lib/turn-engine/flow.ts).
  return rows.reduce((max, r) => Math.max(max, r.turnIndex), -1) + 1;
}

/** Ensure the guest (and optional coach) rows + session mood are present for a
 *  turn whose user row lives at `userIndex`. Safe to call on first write or on
 *  a replay; every step tolerates an already-written row. */
async function completeTurn(
  db: ScopedDb,
  ids: { sessionId: string; workspaceId: string },
  userIndex: number,
  turn: VoiceTurnWrite,
): Promise<number> {
  const guestIndex = userIndex + 1;
  await createIfAbsent(db, {
    ...ids,
    turnIndex: guestIndex,
    role: "guest",
    text: turn.guestText,
    moodSnapshot: turn.mood,
  });
  await db.session.update({
    where: { id: ids.sessionId },
    data: { currentMood: turn.mood },
  });
  if (turn.coachHint) {
    // Best-effort, exactly like the text path: a coaching nudge must never turn
    // a durable turn into an error.
    try {
      await createIfAbsent(db, {
        ...ids,
        turnIndex: userIndex + 2,
        role: "coach",
        text: turn.coachHint,
      });
    } catch (e) {
      console.error("voice coach hint persist failed (non-fatal):", e);
    }
  }
  return guestIndex;
}

export async function persistVoiceTurn(
  db: ScopedDb,
  ids: { sessionId: string; workspaceId: string },
  turn: VoiceTurnWrite,
): Promise<PersistTurnResult> {
  // Fast replay path: this exact turn was already anchored (and is visible to
  // this RLS-scoped trainee). Reconcile any missing rows, then report.
  const existing = await db.message.findUnique({
    where: { idempotencyKey: turn.idempotencyKey },
    select: { turnIndex: true },
  });
  if (existing) {
    const guestIndex = await completeTurn(db, ids, existing.turnIndex, turn);
    return { status: "replayed", guestTurnIndex: guestIndex };
  }

  const userIndex = await nextIndexFor(db, ids.sessionId);
  try {
    await db.message.create({
      data: {
        ...ids,
        turnIndex: userIndex,
        role: "user",
        text: turn.userText,
        idempotencyKey: turn.idempotencyKey,
      },
    });
  } catch (e) {
    if (!isP2002(e)) throw e;
    if (isKeyConflict(e)) {
      // A concurrent retry of the SAME key landed between our findUnique and
      // insert. If we can see it (our tenant), reconcile and report a replay;
      // otherwise it's a cross-tenant key clash we can't own — treat as a
      // collision rather than touching another tenant's row.
      const again = await db.message.findUnique({
        where: { idempotencyKey: turn.idempotencyKey },
        select: { turnIndex: true },
      });
      if (again) {
        const guestIndex = await completeTurn(db, ids, again.turnIndex, turn);
        return { status: "replayed", guestTurnIndex: guestIndex };
      }
    }
    // (sessionId, turnIndex) clash — a different turn took this slot.
    return { status: "collision" };
  }

  const guestIndex = await completeTurn(db, ids, userIndex, turn);
  return { status: "written", guestTurnIndex: guestIndex };
}
