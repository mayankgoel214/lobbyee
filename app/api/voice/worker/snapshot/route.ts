// Worker → app: fetch what the worker needs to run a voice call (Phase 5, M3,
// docs/phase-5-plan.md + lib/voice/wire-contract.md). The worker calls this
// once at the start of a call with its session token and gets back the rendered
// guest system prompt, the conversation so far, and the current mood (as a
// rendered note). It feeds these to its STT→LLM→TTS pipeline.
//
// Deliberately does NOT return the scenario's success criteria (the grading
// rubric): with mood + coaching now computed app-side (see worker/turn), the
// worker never needs the rubric, so it never leaves the app. The guest system
// prompt is rendered here from the SAME prompts/ template the text path uses —
// the worker holds no prompt logic of its own.
//
// SECURITY: session + tenant come from the VERIFIED token claims, never the
// request. The read is RLS-scoped to the token's trainee; re-checks
// status === in_progress so a token for a since-ended session can't pull state.
import { NextResponse } from "next/server";
import { moodNote, OPENING_CUE } from "@/lib/ai/guest";
import { dbForRequest } from "@/lib/db/scoped";
import { rateLimit } from "@/lib/rate-limit";
import { authorizeVoiceRequest } from "@/lib/voice/authorize";
import { loadVoiceSnapshot } from "@/lib/voice/snapshot";
import {
  GUEST_SYSTEM_VERSION,
  renderGuestSystem,
} from "@/prompts/guest-system";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = authorizeVoiceRequest(request);
  if (!auth.ok) return new NextResponse(null, { status: auth.status });

  const { claims } = auth;

  // Looser cost/DB guard than the turn route (snapshot is normally one call per
  // connection and spends no AI, only a scoped read + prompt render). Bounds a
  // reconnect/loop hammer on the same session. Keyed by the verified session
  // claim; fails open.
  const limit = await rateLimit(`voice-snapshot:${claims.sessionId}`, {
    max: 20,
    windowSeconds: 60,
  });
  if (!limit.ok) {
    return new NextResponse(null, {
      status: 429,
      headers: { "Retry-After": String(limit.retryAfterSeconds) },
    });
  }

  // Scoped to the token's trainee — never a client-supplied id, never dbAdmin.
  const db = dbForRequest(claims.userId);
  const loaded = await loadVoiceSnapshot(db, claims.sessionId);
  if (
    !loaded ||
    loaded.userId !== claims.userId ||
    loaded.workspaceId !== claims.workspaceId
  ) {
    // 404 for "can't see it / not yours" — same opaque answer as the mint
    // route, so a token can't be used to probe which sessions exist.
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }
  if (loaded.status !== "in_progress") {
    return NextResponse.json(
      { error: "This session has ended." },
      { status: 409 },
    );
  }

  const s = loaded.snapshot;
  // Only the user/guest turns seed the LLM context; coach turns are internal.
  const history = s.messages
    .filter((m) => m.role === "user" || m.role === "guest")
    .map((m) => ({ role: m.role, text: m.text }));

  return NextResponse.json({
    sessionId: claims.sessionId,
    guestSystemPrompt: renderGuestSystem(s.persona, s.scenario),
    guestSystemVersion: GUEST_SYSTEM_VERSION,
    // The guest speaks first — the worker prepends this if history is empty.
    openingCue: OPENING_CUE,
    currentMood: s.currentMood,
    moodNote: moodNote(s.currentMood),
    history,
  });
}
