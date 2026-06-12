"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isAdmin, requireMembership } from "@/lib/auth/session";
import { dbForRequest } from "@/lib/db/scoped";

export type ScenarioFormState = { error?: string };

const scenarioSchema = z.object({
  slug: z.string().min(1),
  title: z.string().trim().min(3, "Give the scenario a title").max(120),
  situation: z
    .string()
    .trim()
    .min(20, "Describe what just happened in a sentence or three")
    .max(1000),
  difficulty: z.coerce.number().int().min(1).max(5),
  successCriteria: z
    .string()
    .transform((s) =>
      s
        .split("\n")
        .map((c) => c.trim())
        .filter(Boolean),
    )
    .pipe(
      z
        .array(z.string().max(200))
        .min(1, "Add at least one success criterion")
        .max(8),
    ),
});

export async function createScenarioAction(
  _prev: ScenarioFormState,
  formData: FormData,
): Promise<ScenarioFormState> {
  const parsed = scenarioSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { slug, title, situation, difficulty, successCriteria } = parsed.data;

  const { user, workspace, membership } = await requireMembership(slug);
  if (!isAdmin(membership.role)) {
    return { error: "Only owners and managers can create scenarios." };
  }

  await dbForRequest(user.id).scenario.create({
    data: {
      workspaceId: workspace.id,
      title,
      situation,
      difficulty,
      successCriteria,
    },
  });
  revalidatePath(`/w/${slug}/scenarios`);
  return {};
}
