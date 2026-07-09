// Public marketing route. No auth — this is the "watch the product move"
// page. Stays a server component for the metadata surface; the actual demo
// is a self-contained client component (features/marketing/demo-tour.tsx)
// because it needs rAF/setTimeout for the choreographed timeline. The demo
// does NOT import any real app pages or server actions — it re-creates
// simplified, on-brand screens inline so nothing here can leak real data.

import type { Metadata } from "next";
import { DemoTour } from "@/features/marketing/demo-tour";

const description =
  "A 60-second walkthrough of Lobbyee — pick a guest and a situation, practice the hard conversation, get a coaching report scored on empathy, clarity, problem-solving and professionalism.";

export const metadata: Metadata = {
  title: "See Lobbyee in action",
  description,
  openGraph: {
    title: "See Lobbyee in action",
    description,
    type: "website",
    siteName: "Lobbyee",
  },
  twitter: {
    card: "summary_large_image",
    title: "See Lobbyee in action",
    description,
  },
};

export default function DemoPage() {
  return <DemoTour />;
}
