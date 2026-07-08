import { Plus } from "lucide-react";
import Link from "next/link";
import { Button, Card } from "@/components/ui";
import { isAdmin, requireMembership } from "@/lib/auth/session";
import { dbForRequest } from "@/lib/db/scoped";

function DifficultyDots({ level }: { level: number }) {
  return (
    <span
      role="img"
      aria-label={`Difficulty ${level} of 5`}
      className="inline-flex items-center gap-1"
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          className={`h-1.5 w-1.5 rounded-full ${
            n <= level ? "bg-neutral-700" : "bg-neutral-200"
          }`}
        />
      ))}
    </span>
  );
}

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
      <div className="flex items-start justify-between gap-2">
        <h2 className="font-semibold text-neutral-900">{s.title}</h2>
        <DifficultyDots level={s.difficulty} />
      </div>
      <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-neutral-600">
        {s.situation}
      </p>
    </Card>
  );

  return (
    <main className="mx-auto max-w-3xl p-6">
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900">Situations</h1>
          <p className="mt-1 text-sm text-neutral-500">
            The <em>what</em> — the problem your staff practice handling. Any
            guest can play any situation, so a handful of guests times these
            situations is a lot of practice.
          </p>
        </div>
        {admin && (
          <Link href={`/w/${slug}/scenarios/new`}>
            <Button>
              <Plus size={16} strokeWidth={2} aria-hidden="true" />
              New situation
            </Button>
          </Link>
        )}
      </div>

      <h2 className="mb-3 text-xs font-medium text-neutral-500">
        Your workspace
      </h2>
      {workspaceScenarios.length === 0 ? (
        <p className="mb-8 text-sm text-neutral-500">
          Nothing custom yet — start with the library below
          {admin ? " or create your own." : "."}
        </p>
      ) : (
        <div className="mb-8 grid gap-3 sm:grid-cols-2">
          {workspaceScenarios.map((s) => (
            <ScenarioCard key={s.id} s={s} />
          ))}
        </div>
      )}

      <h2 className="mb-3 text-xs font-medium text-neutral-500">Library</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {library.map((s) => (
          <ScenarioCard key={s.id} s={s} />
        ))}
      </div>
    </main>
  );
}
