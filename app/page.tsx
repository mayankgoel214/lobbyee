// Root route. Stays a server component so we can (1) auth-check + redirect
// logged-in users to their workspace before shipping any HTML, and (2) attach
// marketing-specific metadata for SEO / social share cards. The visible
// landing UI is a separate client component (features/marketing/landing.tsx)
// so it can run the hero-opener CSS keyframes and IntersectionObserver-driven
// section reveals without turning this route into a client bundle.

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Landing } from "@/features/marketing/landing";
import { afterAuthDestination, getUser } from "@/lib/auth/session";

const description =
  "AI role-play training for hospitality teams. Your staff practice the hard conversations against a lifelike AI guest, then get a coaching report scored on empathy, clarity, problem-solving, and professionalism.";

export const metadata: Metadata = {
  title: "Lobbyee — AI role-play training for hospitality teams",
  description,
  openGraph: {
    title: "Lobbyee — AI role-play training for hospitality teams",
    description,
    type: "website",
    siteName: "Lobbyee",
  },
  twitter: {
    card: "summary_large_image",
    title: "Lobbyee — AI role-play training for hospitality teams",
    description,
  },
};

export default async function Home() {
  const user = await getUser();
  if (user) redirect(await afterAuthDestination(user.id));

  return <Landing />;
}
