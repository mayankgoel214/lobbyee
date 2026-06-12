// Concrete ports for the TEXT path: AI calls go to lib/ai/*, persistence goes
// through the request's RLS-scoped Prisma client. The Phase 5 voice worker
// will provide its own ports (Gemini SDK + psycopg) against the same
// interfaces in ./types — this file is the only place the engine touches
// Next.js/Prisma server code.
import "server-only";
import { generateCoachHint } from "@/lib/ai/coach";
import { generateGuestReply } from "@/lib/ai/guest";
import { updateMood } from "@/lib/ai/mood";
import type { ScopedDb } from "@/lib/db/scoped";
import type { AIPort, MoodVector, PersistencePort } from "./types";
import { TurnCollisionError } from "./types";

// The lib/ai functions already match the AIPort shape one-for-one.
export const textAI: AIPort = {
  updateMood,
  generateGuest: generateGuestReply,
  coachHint: generateCoachHint,
};

export function textPersistence(
  db: ScopedDb,
  ids: { sessionId: string; workspaceId: string },
): PersistencePort {
  const { sessionId, workspaceId } = ids;
  return {
    async writeUserAndGuest({ nextIndex, userText, guestText, mood }) {
      try {
        await db.message.create({
          data: {
            sessionId,
            workspaceId,
            turnIndex: nextIndex,
            role: "user",
            text: userText,
          },
        });
        await db.message.create({
          data: {
            sessionId,
            workspaceId,
            turnIndex: nextIndex + 1,
            role: "guest",
            text: guestText,
            moodSnapshot: mood,
          },
        });
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
