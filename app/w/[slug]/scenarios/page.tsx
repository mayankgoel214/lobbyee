import Link from "next/link";
import { Card } from "@/components/ui";
import { isAdmin, requireMembership } from "@/lib/auth/session";
import { dbForRequest } from "@/lib/db/scoped";

export default async function ScenariosPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { user, workspace, membership } = await requireMembership(slug);
  const scenarios = await dbForRequest(user.id).scenario.findMany({
    where: { OR: [{ workspaceId: workspace.id }, { workspaceId: null }] },
    orderBy: [{ isLibrary: "asc" }, { createdAt: "desc" }],
  });
  const admin = isAdmin(membership.role);
  const workspaceScenarios = scenarios.filter((s) => !s.isLibrary);
  const library = scenarios.filter((s) => s.isLibrary);

  const ScenarioCard = ({ s }: { s: (typeof scenarios)[number] }) => (
    <Card>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-semibold">{s.title}</h2>
        <span className="text-xs text-neutral-500">
          {"●".repeat(s.difficulty)}
          {"○".repeat(5 - s.difficulty)}
        </span>
      </div>
      <p className="mt-2 line-clamp-3 text-sm text-neutral-600">
        {s.situation}
      </p>
    </Card>
  );

  return (
    <main className="mx-auto max-w-3xl p-6">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Scenarios</h1>
          <p className="text-sm text-neutral-500">
            The “what” — situations your team practices.
          </p>
        </div>
        {admin && (
          <Link
            href={`/w/${slug}/scenarios/new`}
            className="rounded-xl bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-700"
          >
            New scenario
          </Link>
        )}
      </div>

      <h2 className="mb-2 text-xs font-semibold tracking-wide text-neutral-500 uppercase">
        Your workspace
      </h2>
      {workspaceScenarios.length === 0 ? (
        <p className="mb-6 text-sm text-neutral-500">
          Nothing custom yet — start with the library below
          {admin ? " or create your own." : "."}
        </p>
      ) : (
        <div className="mb-6 grid gap-3 sm:grid-cols-2">
          {workspaceScenarios.map((s) => (
            <ScenarioCard key={s.id} s={s} />
          ))}
        </div>
      )}

      <h2 className="mb-2 text-xs font-semibold tracking-wide text-neutral-500 uppercase">
        Library
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {library.map((s) => (
          <ScenarioCard key={s.id} s={s} />
        ))}
      </div>
    </main>
  );
}
