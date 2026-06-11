// Separate module (not "use server") so the schema is exportable and
// unit-testable — server-action files may only export async functions.
import { z } from "zod";

export const inviteSchema = z.object({
  slug: z.string().min(1),
  emails: z
    .string()
    .transform((s) => [
      ...new Set(
        s
          .split(/[\n,;]+/)
          .map((e) => e.trim().toLowerCase())
          .filter(Boolean),
      ),
    ])
    .pipe(
      z.array(z.string().email("One of the emails is invalid")).min(1).max(10),
    ),
});
