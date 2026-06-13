// Worker → app: persist one completed voice turn (Phase 5, M3,
// docs/phase-5-plan.md + lib/voice/wire-contract.md). The worker ran the audio
// (STT → guest LLM → TTS) and sends back ONLY the two lines of dialogue. The
// app reads the guest's new mood + generates the coach hint itself (reusing the
// text-path AI) and persists — so the worker holds no AI prompts and the
// grading rubric never leaves the app. The response returns the new mood (and a
// rendered mood note) for the worker to shape the NEXT guest reply.
//
// SECURITY invariants (audited by /safety-check):
//   - session + tenant come from the VERIFIED token claims, never the body;
//   - re-checks status === in_progress on every write;
//   - writes through dbForRequest(claims.userId) — never dbAdmin;
//   - idempotent on the worker-supplied key (lib/voice/persist-turn.ts);
//   - never logs the token.
import { NextResponse } from "next/server";
import { z } from "zod";
import { moodNote } from "@/lib/ai/guest";
import { dbForRequest } from "@/lib/db/scoped";
import { authorizeVoiceRequest } from "@/lib/voice/authorize";
import { runVoiceTurn } from "@/lib/voice/run-voice-turn";
import { loadVoiceSnapshot } from "@/lib/voice/snapshot";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  // The worker generates one uuid per turn; it anchors idempotency.
  idempotencyKey: z.string().uuid(),
  // trim() first so a whitespace-only turn can't anchor an empty-looking row
  // that still feeds the evaluator.
  userText: z.string().trim().min(1).max(4000),
  guestText: z.string().trim().min(1).max(8000),
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

  // Full snapshot, RLS-scoped and addressed by the TOKEN's session (never the
  // body) — we need the rubric + history here to compute mood/coach.
  const db = dbForRequest(claims.userId);
  const loaded = await loadVoiceSnapshot(db, claims.sessionId);
  if (
    !loaded ||
    loaded.userId !== claims.userId ||
    loaded.workspaceId !== claims.workspaceId
  ) {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }
  if (loaded.status !== "in_progress") {
    return NextResponse.json(
      { error: "This session has ended." },
      { status: 409 },
    );
  }

  const result = await runVoiceTurn(
    db,
    { sessionId: claims.sessionId, workspaceId: loaded.workspaceId },
    loaded.snapshot,
    {
      idempotencyKey: body.idempotencyKey,
      userText: body.userText,
      guestText: body.guestText,
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
    mood: result.mood,
    moodNote: moodNote(result.mood), // rendered, for the next guest reply
    coachHint: result.coachHint, // for the trainee's coach strip (M4)
  });
}
