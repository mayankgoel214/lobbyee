"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  type ScenarioDepthSuggestion,
  suggestScenarioDepth,
} from "@/lib/ai/scenario-designer";
import { isAdmin, requireMembership } from "@/lib/auth/session";
import { dbForRequest } from "@/lib/db/scoped";
import { RESOLVABILITY } from "@/lib/scenario/depth";

export type ScenarioFormState = { error?: string };

/** Empty string → null; otherwise trimmed. Optional depth fields the manager
 *  may leave blank. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

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
  underlyingNeed: optionalText(600),
  resolutionPath: optionalText(600),
  resolvability: z.enum(RESOLVABILITY).default("resolvable"),
});

export async function createScenarioAction(
  _prev: ScenarioFormState,
  formData: FormData,
): Promise<ScenarioFormState> {
  const parsed = scenarioSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const {
    slug,
    title,
    situation,
    difficulty,
    successCriteria,
    underlyingNeed,
    resolutionPath,
    resolvability,
  } = parsed.data;

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
      underlyingNeed,
      resolutionPath,
      resolvability,
    },
  });
  revalidatePath(`/w/${slug}/scenarios`);
  // Redirect on success so the manager lands back on the list and sees the new
  // situation (redirect() throws internally, so nothing after it runs).
  redirect(`/w/${slug}/scenarios`);
}

// --- AI depth suggestion ---------------------------------------------------

export type SuggestDepthState = {
  suggestion?: ScenarioDepthSuggestion;
  error?: string;
};

const suggestSchema = z.object({
  slug: z.string().min(1),
  title: z.string().trim().min(3, "Add a title first").max(120),
  situation: z
    .string()
    .trim()
    .min(20, "Describe the situation first")
    .max(1000),
});

/** Admin-only: draft a hidden underlying need for the scenario the manager is
 *  writing. Returns a suggestion the form pre-fills into editable fields. */
export async function suggestScenarioDepthAction(
  _prev: SuggestDepthState,
  formData: FormData,
): Promise<SuggestDepthState> {
  const parsed = suggestSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { slug, title, situation } = parsed.data;

  // Gate on admin membership before spending a model call.
  const { membership } = await requireMembership(slug);
  if (!isAdmin(membership.role)) {
    return { error: "Only owners and managers can create scenarios." };
  }

  const suggestion = await suggestScenarioDepth({ title, situation });
  if (!suggestion) {
    return {
      error: "Couldn't draft a suggestion just now — write your own below.",
    };
  }
  return { suggestion };
}
