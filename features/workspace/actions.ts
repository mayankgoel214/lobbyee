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
