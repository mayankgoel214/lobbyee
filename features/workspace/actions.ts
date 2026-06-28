"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { dbAdmin } from "@/lib/db/admin";
import { slugify } from "./slug";

export type WorkspaceFormState = { error?: string };

const createSchema = z.object({
  name: z.string().trim().min(2, "Give your workspace a name").max(80),
  industry: z.enum(["hotel", "restaurant", "training_school", "other"]),
});

// SERVICE-PATH JUSTIFICATION (dbAdmin): workspace creation is the bootstrap
// case — the creator has no membership yet, so RLS would (correctly) deny
// everything. Identity is verified via requireUser(); the new workspace and
// the owner membership are created atomically for that user only.
export async function createWorkspaceAction(
  _prev: WorkspaceFormState,
  formData: FormData,
): Promise<WorkspaceFormState> {
  const user = await requireUser();
  const parsed = createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { name, industry } = parsed.data;

  // Trial-abuse / Gemini-spend cap: each workspace gets a fresh 10-session
  // free trial, so an unbounded number of owner workspaces means unbounded
  // free model spend per identity. Hold any one user to a small number of
  // owned workspaces. Counted via dbAdmin because the user may have no
  // active membership in some of these yet (and this is the same bootstrap
  // path the existing creation flow uses below — same justification).
  const ownerCount = await dbAdmin.membership.count({
    where: { userId: user.id, role: "owner" },
  });
  if (ownerCount >= 3) {
    return {
      error:
        "You already own the maximum number of workspaces (3). Archive or transfer one before creating another.",
    };
  }

  const base = slugify(name);
  let slug = base;
  for (let attempt = 0; ; attempt++) {
    try {
      await dbAdmin.workspace.create({
        data: {
          slug,
          name,
          industry,
          memberships: {
            create: { userId: user.id, role: "owner", status: "active" },
          },
        },
      });
      break;
    } catch (e: unknown) {
      const code = (e as { code?: string }).code;
      if (code === "P2002" && attempt < 5) {
        slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;
        continue;
      }
      console.error("workspace create failed:", e);
      return { error: "Could not create the workspace — try again." };
    }
  }
  redirect(`/w/${slug}`);
}
