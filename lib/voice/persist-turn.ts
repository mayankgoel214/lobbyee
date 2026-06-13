// Persist one voice turn the Pipecat worker has already run (Phase 5, M2).
//
// Unlike the text path (lib/turn-engine), the worker does the AI itself — it
// streams the guest reply straight into TTS for low latency — so by the time
// it calls us the turn is DONE. This function only writes it down, mirroring
// the indexing + row shape the engine's textPersistence uses (user at N, guest
// at N+1 with the mood snapshot, optional coach hint at N+2).
//
// It is idempotent on `idempotencyKey` (the worker stamps the user row), scoped
// per session: a retried write replays instead of double-inserting, and a write
// that partially landed before a crash is reconciled to a complete turn on the
// retry. Because the scoped Prisma client can't run a multi-row transaction
// (see lib/db/scoped.ts), each row is its own write — so reconciliation guards
// every insert against landing in a row that isn't ours (would corrupt the
// transcript) and surfaces that as a collision instead.
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
  // A *different* turn already occupies a slot this turn needs — a real
  // concurrent write. The route maps this to 409 so the worker can refetch the
  // snapshot and retry rather than blindly resend.
  | { status: "collision" };

type Role = "user" | "guest" | "coach";

type RowData = {
  sessionId: string;
  workspaceId: string;
  turnIndex: number;
  role: Role;
  text: string;
  moodSnapshot?: MoodVector;
  idempotencyKey?: string;
};

/** Thrown when an insert collides on (sessionId, turnIndex) with a row that
 *  isn't the one we meant to write — i.e. a different turn took the slot. */
class SlotConflictError extends Error {}

function isP2002(e: unknown): boolean {
  return (e as { code?: string })?.code === "P2002";
}

/** Idempotent insert of one message row. On a unique-constraint clash, confirm
 *  the row already sitting in this (sessionId, turnIndex) slot is the one we
 *  intended (same role) — if it's a different turn's row, raise SlotConflict so
 *  the caller never silently reports success against a corrupted slot. */
async function ensureRow(db: ScopedDb, data: RowData): Promise<void> {
  try {
    await db.message.create({ data });
    return;
  } catch (e) {
    if (!isP2002(e)) throw e;
  }
  const existing = await db.message.findUnique({
    where: {
      sessionId_turnIndex: {
        sessionId: data.sessionId,
        turnIndex: data.turnIndex,
      },
    },
    select: { role: true },
  });
  // No row (the clash was on the idempotency key, handled by the caller) or a
  // different role in our slot → not ours.
  if (!existing || existing.role !== data.role) throw new SlotConflictError();
}

/** Highest turn index in the session + 1 — survives any earlier partial write
 *  and never depends on row order (mirrors lib/turn-engine/flow.ts). Reads a
 *  single row via the (session_id, turn_index) index, not the whole transcript. */
async function nextIndexFor(db: ScopedDb, sessionId: string): Promise<number> {
  const top = await db.message.findFirst({
    where: { sessionId },
    orderBy: { turnIndex: "desc" },
    select: { turnIndex: true },
  });
  return (top?.turnIndex ?? -1) + 1;
}

/** Ensure the guest (+ optional coach) rows and the session mood are present
 *  for a turn whose user row lives at `userIndex`. Safe to call on a first
 *  write or a replay; every step tolerates an already-written row, and raises
 *  SlotConflictError if a foreign turn occupies a slot we need. */
async function completeTurn(
  db: ScopedDb,
  ids: { sessionId: string; workspaceId: string },
  userIndex: number,
  turn: VoiceTurnWrite,
): Promise<number> {
  const guestIndex = userIndex + 1;
  await ensureRow(db, {
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
    // a durable turn into an error — swallow ALL failures here (including a
    // SlotConflict on the coach slot), only logging.
    try {
      await ensureRow(db, {
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
  try {
    // Fast replay path: this exact turn was already anchored in THIS session.
    // (Uniqueness is per-session, so the key can't refer to another tenant's
    // row.) Reconcile any rows a prior crash left missing, then report.
    const existing = await db.message.findFirst({
      where: { sessionId: ids.sessionId, idempotencyKey: turn.idempotencyKey },
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
      // A concurrent retry of the SAME key landed between our read and insert.
      const again = await db.message.findFirst({
        where: {
          sessionId: ids.sessionId,
          idempotencyKey: turn.idempotencyKey,
        },
        select: { turnIndex: true },
      });
      if (again) {
        const guestIndex = await completeTurn(db, ids, again.turnIndex, turn);
        return { status: "replayed", guestTurnIndex: guestIndex };
      }
      // The clash was on (sessionId, turnIndex): a different turn took the slot.
      return { status: "collision" };
    }

    const guestIndex = await completeTurn(db, ids, userIndex, turn);
    return { status: "written", guestTurnIndex: guestIndex };
  } catch (e) {
    if (e instanceof SlotConflictError) return { status: "collision" };
    throw e;
  }
}
