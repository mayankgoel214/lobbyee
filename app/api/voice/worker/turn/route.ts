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
import { rateLimit } from "@/lib/rate-limit";
import {
  authorizeVoiceRequest,
  requestIsFromWorker,
} from "@/lib/voice/authorize";
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

  // Cost guard: each persisted turn spends a mood + coach Gemini pair. The mint
  // endpoint is capped per-user, but once a token is issued this endpoint is the
  // hot path — a buggy/adversarial/looping worker (or a leaked token) could
  // otherwise drive unbounded AI spend until the token expires. 40/min per
  // SESSION (from the verified token claim, never the body) is far above any
  // human voice cadence while killing a hot loop. Fails open like all limits.
  const limit = await rateLimit(`voice-turn:${claims.sessionId}`, {
    max: 40,
    windowSeconds: 60,
  });
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many turns; slow down." },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      },
    );
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  // Depth (hidden need + resolvability) flows into mood only when the caller
  // proves it's the worker — same gate as the snapshot route, so the guest's
  // behavior and its mood stay consistent.
  const includeDepth = requestIsFromWorker(request);

  // Full snapshot, RLS-scoped and addressed by the TOKEN's session (never the
  // body) — we need the scenario + history here to compute mood/coach/outcome.
  const db = dbForRequest(claims.userId);
  const loaded = await loadVoiceSnapshot(db, claims.sessionId, {
    includeDepth,
  });
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

  // Conversation-length cap — MIRRORS the text path (features/sessions/actions.ts:
  // sendTurnAction). Count only real dialogue (coach hints add a third row per
  // turn and must not shrink the budget). Without this, the voice path had no
  // ceiling: a valid token could persist turns until it expired. 409 so the
  // worker treats it as terminal and stops resending.
  const conversationTurns = loaded.snapshot.messages.filter(
    (m) => m.role !== "coach",
  ).length;
  if (conversationTurns >= 80) {
    return NextResponse.json(
      { error: "This session is very long. End it to get your transcript." },
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
    // The worker forwards this to the browser (data channel) so the voice UI
    // can show the win-state banner. Not secret — just the outcome label.
    outcome: result.outcome,
  });
}
