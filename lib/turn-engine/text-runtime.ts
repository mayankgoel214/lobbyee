// Concrete ports for the TEXT path: AI calls go to lib/ai/*, persistence goes
// through the request's RLS-scoped Prisma client. The Phase 5 voice worker
// will provide its own ports (Gemini SDK + psycopg) against the same
// interfaces in ./types — this file is the only place the engine touches
// Next.js/Prisma server code.
import "server-only";
import { generateCoachHint } from "@/lib/ai/coach";
import { generateGuestReply } from "@/lib/ai/guest";
import { updateMood } from "@/lib/ai/mood";
import { writeRowsAsTenant } from "@/lib/db/admin";
import type { ScopedDb } from "@/lib/db/scoped";
import type { AIPort, MoodVector, PersistencePort } from "./types";
import { TurnCollisionError } from "./types";

// The lib/ai functions already match the AIPort shape one-for-one.
export const textAI: AIPort = {
  updateMood,
  generateGuest: generateGuestReply,
  coachHint: generateCoachHint,
};

// SECURITY: `db` MUST be the request's RLS-scoped client (`dbForRequest(userId)`),
// NEVER `dbAdmin`. The `ScopedDb` type enforces this at compile time — do not
// widen it or cast `dbAdmin` to it. Passing an unscoped client here would write
// tenant rows with RLS off. workspaceId/sessionId must come from an RLS-validated
// read (see sendTurnAction), never from raw client input.
//
// `userId` is threaded in solely so writeUserAndGuest can call
// writeRowsAsTenant (see lib/db/admin.ts) — that helper opens ONE Postgres
// transaction under this trainee's RLS context so the user+guest row pair
// commits atomically. Other ports keep using `db` (each its own scoped txn —
// fine, because they're single-statement writes).
export function textPersistence(
  db: ScopedDb,
  ids: { sessionId: string; workspaceId: string; userId: string },
): PersistencePort {
  const { sessionId, workspaceId, userId } = ids;
  return {
    async writeUserAndGuest({ nextIndex, userText, guestText, mood }) {
      try {
        // ONE transaction (RLS-scoped via writeRowsAsTenant) for both rows —
        // a transient pg failure between them used to leave an orphan user
        // row and corrupt the transcript the evaluator later read.
        await writeRowsAsTenant(userId, (tx) => [
          tx.message.create({
            data: {
              sessionId,
              workspaceId,
              turnIndex: nextIndex,
              role: "user",
              text: userText,
            },
          }),
          tx.message.create({
            data: {
              sessionId,
              workspaceId,
              turnIndex: nextIndex + 1,
              role: "guest",
              text: guestText,
              moodSnapshot: mood,
            },
          }),
        ]);
      } catch (e: unknown) {
        // Concurrent turn (second tab / double submit) collides on the
        // (sessionId, turnIndex) unique constraint.
        if ((e as { code?: string }).code === "P2002") {
          throw new TurnCollisionError();
        }
        throw e;
      }
    },
    async setCurrentMood(mood: MoodVector) {
      await db.session.update({
        where: { id: sessionId },
        data: { currentMood: mood },
      });
    },
    async writeCoachHint({ turnIndex, text }) {
      await db.message.create({
        data: { sessionId, workspaceId, turnIndex, role: "coach", text },
      });
    },
  };
}
