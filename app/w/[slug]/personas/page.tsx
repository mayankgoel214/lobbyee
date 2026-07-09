import { Plus } from "lucide-react";
import Link from "next/link";
import { Button, Card } from "@/components/ui";
import { isAdmin, requireMembership } from "@/lib/auth/session";
import { dbForRequest } from "@/lib/db/scoped";

export default async function PersonasPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { user, workspace, membership } = await requireMembership(slug);
  const personas = await dbForRequest(user.id).persona.findMany({
    where: { workspaceId: workspace.id },
    orderBy: { createdAt: "desc" },
  });
  const admin = isAdmin(membership.role);

  return (
    <main className="mx-auto max-w-4xl p-6 md:p-8">
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
            Guests
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            The <em>who</em>: the people your staff practice with, each with
            their own temperament and backstory. One guest can play any
            situation, so a few guests go a long way.
          </p>
        </div>
        {admin && (
          <Link href={`/w/${slug}/personas/new`}>
            <Button>
              <Plus size={16} strokeWidth={2} aria-hidden="true" />
              New guest
            </Button>
          </Link>
        )}
      </div>
      {personas.length === 0 ? (
        <Card>
          <p className="text-sm text-neutral-600">
            No personas yet.{" "}
            {admin
              ? "Create your first guest: a name, a type, a short backstory, and a starting mood."
              : "Ask a manager to create one."}
          </p>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {personas.map((p) => {
            const initial = p.name.trim().charAt(0).toUpperCase() || "G";
            return (
              <Card key={p.id} className="p-5">
                <div className="flex items-start gap-3">
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-50 text-sm font-semibold text-accent-800"
                    aria-hidden="true"
                  >
                    {initial}
                  </span>
                  <div className="min-w-0">
                    <h2 className="font-semibold text-neutral-900">{p.name}</h2>
                    <p className="mt-0.5 text-xs font-medium text-neutral-500">
                      {p.guestType}
                    </p>
                  </div>
                </div>
                <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-neutral-600">
                  {p.backstory}
                </p>
              </Card>
            );
          })}
        </div>
      )}
    </main>
  );
}
