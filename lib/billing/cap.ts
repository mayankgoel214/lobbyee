// The session cap, enforced atomically (docs/architecture.md §7b): a single
// conditional UPDATE means two concurrent session starts can never both slip
// past the limit — there is no read-then-write window.
//
// Plans: trial = TRIAL_SESSION_CAP sessions TOTAL (the counter never resets
// — a trial is a taste, not a free tier); starter = session_cap_monthly per
// billing period, reset to 0 by the invoice.paid webhook.
//
// SERVICE-PATH JUSTIFICATION (dbAdmin): sessions_used_this_period is
// deliberately NOT client-writable (migration 4 limits the workspace UPDATE
// grant to name/industry), so the counter can only move through these two
// functions. workspaceId is always taken from an RLS-validated read, never
// from client input.
import "server-only";
import { dbAdmin } from "@/lib/db/admin";

export const TRIAL_SESSION_CAP = 10;

export type CapResult =
  | { ok: true; used: number; cap: number }
  | { ok: false; used: number; cap: number; plan: "trial" | "starter" };

/** Claim one session slot. Returns ok:false (without incrementing) when the
 *  workspace is at its cap. */
export async function claimSessionSlot(
  workspaceId: string,
): Promise<CapResult> {
  const rows = await dbAdmin.$queryRaw<
    { sessions_used_this_period: number; cap: number }[]
  >`
    UPDATE "workspace"
    SET "sessions_used_this_period" = "sessions_used_this_period" + 1
    WHERE "id" = ${workspaceId}::uuid
      AND "sessions_used_this_period" <
        (CASE WHEN "plan" = 'trial'::"Plan" THEN ${TRIAL_SESSION_CAP} ELSE "session_cap_monthly" END)
    RETURNING "sessions_used_this_period",
      (CASE WHEN "plan" = 'trial'::"Plan" THEN ${TRIAL_SESSION_CAP} ELSE "session_cap_monthly" END) AS cap`;
  const row = rows[0];
  if (row) {
    return { ok: true, used: row.sessions_used_this_period, cap: row.cap };
  }
  // At cap (or workspace gone) — read the state for the error message.
  const ws = await dbAdmin.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      plan: true,
      sessionCapMonthly: true,
      sessionsUsedThisPeriod: true,
    },
  });
  const plan = ws?.plan === "starter" ? "starter" : "trial";
  return {
    ok: false,
    used: ws?.sessionsUsedThisPeriod ?? 0,
    cap: plan === "trial" ? TRIAL_SESSION_CAP : (ws?.sessionCapMonthly ?? 0),
    plan,
  };
}

/** Compensation for failure paths AFTER a successful claim (LLM call failed,
 *  session never persisted) — the trainee shouldn't pay for our error. */
export async function releaseSessionSlot(workspaceId: string): Promise<void> {
  await dbAdmin.$executeRaw`
    UPDATE "workspace"
    SET "sessions_used_this_period" = greatest("sessions_used_this_period" - 1, 0)
    WHERE "id" = ${workspaceId}::uuid`;
}
