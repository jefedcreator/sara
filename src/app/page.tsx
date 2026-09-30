import { type Metadata } from "next";

import { LandingPage } from "@/app/components/landing/LandingPage";
import { CARDS, pageMetadata } from "@/utils/metadata";

// The card itself is app/opengraph-image.tsx.
export const metadata: Metadata = pageMetadata({
  title: CARDS.site.title,
  description:
    "Invoices, receipts, booking links and your daily numbers, from the WhatsApp or Instagram chat you already use. Built for Nigerian service businesses.",
  path: "/",
});

export default function HomePage() {
  return <LandingPage />;
}
