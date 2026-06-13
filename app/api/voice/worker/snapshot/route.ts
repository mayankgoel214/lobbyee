// Worker → app: fetch the conversation snapshot for a voice session (Phase 5,
// M2, docs/phase-5-plan.md). The Pipecat worker calls this once at the start
// of a call with its session token; the response is everything the turn engine
// needs to run the conversation — including the scenario's success criteria
// (the grading rubric), which the engine feeds the coach and evaluator.
//
// This rubric flows app → worker only. It must NEVER reach the trainee's
// browser (see the comment in ../../session-token/route.ts); that's the whole
// reason the worker fetches it here with its own token instead of receiving it
// from the client at handshake.
//
// SECURITY: the session + tenant are read from the VERIFIED token claims, never
// from the request. The read is RLS-scoped to the token's trainee, so even a
// bug here can't cross tenants. Re-checks status === in_progress so a token
// minted for a since-ended session can't pull a live snapshot.
import { NextResponse } from "next/server";
import { dbForRequest } from "@/lib/db/scoped";
import { authorizeVoiceRequest } from "@/lib/voice/authorize";
import { loadVoiceSnapshot } from "@/lib/voice/snapshot";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = authorizeVoiceRequest(request);
  if (!auth.ok) return new NextResponse(null, { status: auth.status });

  const { claims } = auth;
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

  // The worker consumes this directly as the engine's ConversationSnapshot.
  return NextResponse.json({
    sessionId: claims.sessionId,
    snapshot: loaded.snapshot,
  });
}
