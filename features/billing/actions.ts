"use server";

// Billing server actions (docs/architecture.md §13 Phase 4) — admin-only.
// Checkout and the customer portal are Stripe-hosted: no card data ever
// touches our servers.
import { redirect } from "next/navigation";
import { isAdmin, requireMembership } from "@/lib/auth/session";
import { dbAdmin } from "@/lib/db/admin";
import { env } from "@/lib/env";
import { siteUrl } from "@/lib/site-url";
import { billingConfigured, stripe } from "@/lib/stripe/client";

export type BillingActionState = { error?: string };

/** Find-or-create the workspace's Stripe customer.
 *  SERVICE-PATH JUSTIFICATION (dbAdmin): stripe_customer_id is deliberately
 *  not client-writable (migration 4); the workspaceId comes from an
 *  RLS-validated membership, and this only ever writes the id Stripe just
 *  issued for THIS workspace. */
async function ensureStripeCustomer(workspace: {
  id: string;
  name: string;
  stripeCustomerId: string | null;
}): Promise<string> {
  if (workspace.stripeCustomerId) return workspace.stripeCustomerId;
  const customer = await stripe().customers.create({
    name: workspace.name,
    metadata: { workspaceId: workspace.id },
  });
  await dbAdmin.workspace.update({
    where: { id: workspace.id },
    data: { stripeCustomerId: customer.id },
  });
  return customer.id;
}

export async function startCheckoutAction(
  _prev: BillingActionState,
  formData: FormData,
): Promise<BillingActionState> {
  const slug = String(formData.get("slug") ?? "");
  const { workspace, membership } = await requireMembership(slug);
  if (!isAdmin(membership.role)) {
    return { error: "Only workspace admins can manage billing." };
  }
  const priceId = env.STRIPE_PRICE_ID;
  if (!billingConfigured() || !priceId) {
    return { error: "Billing isn't configured yet — check back soon." };
  }

  const customerId = await ensureStripeCustomer(workspace);
  let checkoutUrl: string | null;
  try {
    const session = await stripe().checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      client_reference_id: workspace.id,
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: { metadata: { workspaceId: workspace.id } },
      success_url: `${siteUrl()}/w/${slug}/billing?checkout=success`,
      cancel_url: `${siteUrl()}/w/${slug}/billing?checkout=canceled`,
    });
    checkoutUrl = session.url;
  } catch (e) {
    console.error("stripe checkout create failed:", e);
    return { error: "Couldn't start checkout — try again in a moment." };
  }
  if (!checkoutUrl) return { error: "Couldn't start checkout — try again." };
  redirect(checkoutUrl);
}

export async function openPortalAction(
  _prev: BillingActionState,
  formData: FormData,
): Promise<BillingActionState> {
  const slug = String(formData.get("slug") ?? "");
  const { workspace, membership } = await requireMembership(slug);
  if (!isAdmin(membership.role)) {
    return { error: "Only workspace admins can manage billing." };
  }
  if (!workspace.stripeCustomerId) {
    return { error: "No billing account yet — subscribe first." };
  }
  let portalUrl: string;
  try {
    const session = await stripe().billingPortal.sessions.create({
      customer: workspace.stripeCustomerId,
      return_url: `${siteUrl()}/w/${slug}/billing`,
    });
    portalUrl = session.url;
  } catch (e) {
    console.error("stripe portal create failed:", e);
    return { error: "Couldn't open the billing portal — try again." };
  }
  redirect(portalUrl);
}
