import Link from "next/link";
import { notFound } from "next/navigation";
import { ChatSession } from "@/features/sessions/chat";
import { isMoodVector } from "@/lib/ai/mood";
import { requireMembership } from "@/lib/auth/session";
import { dbForRequest } from "@/lib/db/scoped";

export default async function SessionPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  const { user } = await requireMembership(slug);

  // Scoped read — RLS: owners see their own sessions, admins see all in
  // the workspace. Anyone else gets null → 404.
  const session = await dbForRequest(user.id).session.findUnique({
    where: { id },
    include: {
      persona: true,
      scenario: true,
      messages: { orderBy: { turnIndex: "asc" } },
    },
  });
  if (!session) notFound();

  const mood = isMoodVector(session.currentMood)
    ? session.currentMood
    : { frustration: 50, trust: 50, patience: 50, satisfaction: 50 };
  const chatMessages = session.messages
    .filter((m) => m.role === "user" || m.role === "guest")
    .map((m) => ({
      role: m.role as "user" | "guest",
      text: m.text,
      turnIndex: m.turnIndex,
    }));

  const live = session.status === "in_progress" && session.userId === user.id;
  if (live) {
    return (
      <ChatSession
        sessionId={session.id}
        personaName={session.persona.name}
        scenarioTitle={session.scenario.title}
        initialMessages={chatMessages}
        initialMood={mood}
      />
    );
  }

  // Transcript view (ended sessions, or a manager reviewing).
  return (
    <main className="mx-auto max-w-xl p-6">
      <div className="mb-4">
        <h1 className="text-lg font-semibold">{session.scenario.title}</h1>
        <p className="text-sm text-neutral-500">
          with {session.persona.name} ·{" "}
          {session.status === "in_progress" ? "in progress" : session.status} ·{" "}
          {session.messages.length} turns
        </p>
      </div>
      <div className="mb-5 rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-600">
        Coaching feedback lands here in the next phase — for now, your
        transcript is saved below.
      </div>
      <div className="flex flex-col gap-3">
        {chatMessages.map((m) => (
          <div
            key={m.turnIndex}
            className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm ${
              m.role === "guest"
                ? "self-start border border-neutral-200 bg-white text-neutral-900"
                : "self-end bg-neutral-900 text-white"
            }`}
          >
            {m.text}
          </div>
        ))}
      </div>
      <div className="mt-6">
        <Link
          href={`/w/${slug}/train`}
          className="text-sm font-medium underline"
        >
          ← Back to training
        </Link>
      </div>
    </main>
  );
}
