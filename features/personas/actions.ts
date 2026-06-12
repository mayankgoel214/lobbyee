"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isAdmin, requireMembership } from "@/lib/auth/session";
import { dbForRequest } from "@/lib/db/scoped";

export type PersonaFormState = { error?: string };

const personaSchema = z.object({
  slug: z.string().min(1),
  name: z.string().trim().min(2, "Give the guest a name").max(80),
  guestType: z.string().trim().min(2, "What kind of guest are they?").max(80),
  backstory: z
    .string()
    .trim()
    .min(20, "A couple of sentences of backstory helps the guest feel real")
    .max(600),
  frustration: z.coerce.number().int().min(0).max(100),
  trust: z.coerce.number().int().min(0).max(100),
  patience: z.coerce.number().int().min(0).max(100),
  satisfaction: z.coerce.number().int().min(0).max(100),
});

export async function createPersonaAction(
  _prev: PersonaFormState,
  formData: FormData,
): Promise<PersonaFormState> {
  const parsed = personaSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { slug, name, guestType, backstory, ...mood } = parsed.data;

  const { user, workspace, membership } = await requireMembership(slug);
  if (!isAdmin(membership.role)) {
    return { error: "Only owners and managers can create personas." };
  }

  // Scoped client — persona_insert RLS policy enforces workspace admin.
  await dbForRequest(user.id).persona.create({
    data: {
      workspaceId: workspace.id,
      name,
      guestType,
      backstory,
      baselineMood: mood,
    },
  });
  revalidatePath(`/w/${slug}/personas`);
  return {};
}
