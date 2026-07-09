// The billing page moved into Settings. Redirect old links (including
// Stripe checkout success/cancel returns and existing bookmarks) to the new
// location, preserving the ?checkout=... query so the success/cancel banners
// still render on the settings/billing page.
import { redirect } from "next/navigation";

export default async function BillingLegacyRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ checkout?: string }>;
}) {
  const { slug } = await params;
  const { checkout } = await searchParams;
  const query = checkout ? `?checkout=${encodeURIComponent(checkout)}` : "";
  redirect(`/w/${slug}/settings/billing${query}`);
}
