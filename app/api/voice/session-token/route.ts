// Voice handshake — mint a short-lived token for an in-progress session
// (Phase 5, docs/phase-5-plan.md M2). The trainee's client calls this, then
// hands the token + snapshot to the Pipecat worker so it can run the
// conversation and persist turns back through the app without holding any
// credentials. RLS + the ownership check gate who can start a voice session.
import { NextResponse } from "next/server";
import { z } from "zod";
import { getUser } from "@/lib/auth/session";
import { dbForRequest } from "@/lib/db/scoped";
import { env } from "@/lib/env";
import { loadVoiceSnapshot } from "@/lib/voice/snapshot";
import { signVoiceToken } from "@/lib/voice/token";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ sessionId: z.string().uuid() });

export async function POST(request: Request) {
  const secret = env.VOICE_SESSION_TOKEN_SECRET;
  if (!secret) {
    // Server-side only; the client just sees "not configured". Voice is off
    // until the secret is set on the project.
    console.error(
      "voice session-token: VOICE_SESSION_TOKEN_SECRET not configured",
    );
    return NextResponse.json(
      { error: "Voice isn't available." },
      {
        status: 503,
      },
    );
  }

  const user = await getUser();
  if (!user) return new NextResponse(null, { status: 401 });

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  // Scoped read — RLS proves the session is visible to this user; the explicit
  // ownership check then restricts a LIVE voice drive to the session's own
  // trainee (an admin can view but not speak as them), mirroring sendTurn.
  const db = dbForRequest(user.id);
  const loaded = await loadVoiceSnapshot(db, body.sessionId);
  if (!loaded || loaded.userId !== user.id) {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }
  if (loaded.status !== "in_progress") {
    return NextResponse.json(
      { error: "This session has ended." },
      {
        status: 409,
      },
    );
  }

  const token = signVoiceToken(
    {
      sessionId: body.sessionId,
      workspaceId: loaded.workspaceId,
      userId: user.id,
    },
    secret,
  );

  return NextResponse.json({
    token,
    sessionId: body.sessionId,
    snapshot: loaded.snapshot,
  });
}
