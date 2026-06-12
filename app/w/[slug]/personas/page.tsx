import Link from "next/link";
import { Card } from "@/components/ui";
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
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Guest personas</h1>
          <p className="text-sm text-neutral-500">
            The “who” of every training session.
          </p>
        </div>
        {admin && (
          <Link
            href={`/w/${slug}/personas/new`}
            className="rounded-xl bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-700"
          >
            New persona
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
              <h2 className="font-semibold">{p.name}</h2>
              <p className="text-xs tracking-wide text-neutral-500 uppercase">
                {p.guestType}
              </p>
              <p className="mt-2 line-clamp-3 text-sm text-neutral-600">
                {p.backstory}
              </p>
            </Card>
          ))}
        </div>
      )}
    </main>
  );
}
