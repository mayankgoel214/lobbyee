// Worker → app: persist one completed voice turn (Phase 5, M2,
// docs/phase-5-plan.md). The Pipecat worker ran the turn itself (STT → Gemini →
// TTS) and POSTs the result here so it lands in the same tables, behind the
// same RLS, as a text turn — the worker holds no DB credentials.
//
// SECURITY invariants (audited by /safety-check):
//   - session + tenant come from the VERIFIED token claims, never the body;
//   - the body's ids/text are validated but never used to address rows;
//   - re-checks status === in_progress on every write (a token outlives a
//     session, and a session can end mid-call);
//   - writes through dbForRequest(claims.userId) — never dbAdmin;
//   - idempotent on the worker-supplied key, so a network retry can't double-
//     write (see lib/voice/persist-turn.ts);
//   - never logs the token (authorizeVoiceRequest reads it; nothing here echoes
//     the Authorization header).
import { NextResponse } from "next/server";
import { z } from "zod";
import { clampMood, moodVectorSchema } from "@/lib/ai/mood";
import { dbForRequest } from "@/lib/db/scoped";
import { authorizeVoiceRequest } from "@/lib/voice/authorize";
import { persistVoiceTurn } from "@/lib/voice/persist-turn";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  // The worker generates one uuid per turn; it anchors idempotency.
  idempotencyKey: z.string().uuid(),
  // trim() first so a whitespace-only turn can't anchor an empty-looking row
  // that still feeds the evaluator.
  userText: z.string().trim().min(1).max(4000),
  guestText: z.string().trim().min(1).max(8000),
  mood: moodVectorSchema,
  coachHint: z.string().max(2000).nullish(),
});

export async function POST(request: Request) {
  const auth = authorizeVoiceRequest(request);
  if (!auth.ok) return new NextResponse(null, { status: auth.status });
  const { claims } = auth;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  // Light, RLS-scoped ownership/status read — addressed by the TOKEN's session,
  // not anything in the body. (We don't need the full snapshot to persist.)
  const db = dbForRequest(claims.userId);
  const session = await db.session.findUnique({
    where: { id: claims.sessionId },
    select: { workspaceId: true, userId: true, status: true },
  });
  if (
    !session ||
    session.userId !== claims.userId ||
    session.workspaceId !== claims.workspaceId
  ) {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }
  if (session.status !== "in_progress") {
    return NextResponse.json(
      { error: "This session has ended." },
      { status: 409 },
    );
  }

  const result = await persistVoiceTurn(
    db,
    { sessionId: claims.sessionId, workspaceId: session.workspaceId },
    {
      idempotencyKey: body.idempotencyKey,
      userText: body.userText,
      guestText: body.guestText,
      mood: clampMood(body.mood),
      coachHint: body.coachHint ?? null,
    },
  );

  if (result.status === "collision") {
    // A concurrent write took the next slot — the worker should refetch the
    // snapshot and retry rather than blindly resend.
    return NextResponse.json(
      { error: "Turn could not be ordered; refetch and retry." },
      { status: 409 },
    );
  }
  return NextResponse.json({
    status: result.status, // "written" | "replayed"
    guestTurnIndex: result.guestTurnIndex,
  });
}
