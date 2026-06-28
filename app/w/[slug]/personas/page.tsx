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
    <main className="mx-auto max-w-3xl p-6">
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900">
            Guest personas
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            The &ldquo;who&rdquo; of every training session.
          </p>
        </div>
        {admin && (
          <Link href={`/w/${slug}/personas/new`}>
            <Button>
              <Plus size={16} strokeWidth={2} aria-hidden="true" />
              New persona
            </Button>
          </Link>
        )}
      </div>
      {personas.length === 0 ? (
        <Card>
          <p className="text-sm text-neutral-600">
            No personas yet.{" "}
            {admin
              ? "Create your first guest — a name, a type, a short backstory, and a starting mood."
              : "Ask a manager to create one."}
          </p>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {personas.map((p) => (
            <Card key={p.id}>
              <h2 className="font-semibold text-neutral-900">{p.name}</h2>
              <p className="mt-0.5 text-xs font-medium text-neutral-500">
                {p.guestType}
              </p>
              <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-neutral-600">
                {p.backstory}
              </p>
            </Card>
          ))}
        </div>
      )}
    </main>
  );
}
