import { Plus } from "lucide-react";
import Link from "next/link";
import { Badge, Button, Card } from "@/components/ui";
import { isAdmin, requireMembership } from "@/lib/auth/session";
import { dbForRequest } from "@/lib/db/scoped";
import { asResolvability, RESOLVABILITY_LABELS } from "@/lib/scenario/depth";

function DifficultyDots({ level }: { level: number }) {
  // Difficulty ramps color from teal (easy) → orange → red so the eye lands
  // on the hardest scenarios first.
  const tone =
    level >= 4 ? "bg-bad" : level >= 3 ? "bg-problem" : "bg-accent-600";
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
            n <= level ? tone : "bg-neutral-200"
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

  const ScenarioCard = ({ s }: { s: (typeof scenarios)[number] }) => {
    const resolvability = asResolvability(s.resolvability);
    const resolvabilityVariant =
      resolvability === "resolvable"
        ? "good"
        : resolvability === "partial"
          ? "warn"
          : "bad";
    return (
      <Card className="p-5">
        <div className="flex items-start justify-between gap-2">
          <h2 className="font-semibold text-neutral-900">{s.title}</h2>
          <DifficultyDots level={s.difficulty} />
        </div>
        <div className="mt-2">
          <Badge variant={resolvabilityVariant}>
            {RESOLVABILITY_LABELS[resolvability]}
          </Badge>
        </div>
        <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-neutral-600">
          {s.situation}
        </p>
      </Card>
    );
  };

  return (
    <main className="mx-auto max-w-4xl p-6 md:p-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
            Situations
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            The <em>what</em>: the problem your staff practice handling. Any
            guest can play any situation, so a handful of guests times these
            situations is a lot of practice.
          </p>
        </div>
        {admin && (
          <Link href={`/w/${slug}/scenarios/new`} className="shrink-0">
            <Button>
              <Plus size={16} strokeWidth={2} aria-hidden="true" />
              New situation
            </Button>
          </Link>
        )}
      </div>

      <h2 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-neutral-400">
        Your workspace
      </h2>
      {workspaceScenarios.length === 0 ? (
        <p className="mb-8 text-sm text-neutral-500">
          Nothing custom yet. Start with the library below
          {admin ? " or create your own." : "."}
        </p>
      ) : (
        <div className="mb-8 grid gap-3 sm:grid-cols-2">
          {workspaceScenarios.map((s) => (
            <ScenarioCard key={s.id} s={s} />
          ))}
        </div>
      )}

      <h2 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-neutral-400">
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
