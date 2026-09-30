import { type Metadata } from "next";

import { LandingPage } from "@/app/components/landing/LandingPage";

const title = "Sara · Run your business from WhatsApp";
const description =
  "Invoices, receipts, booking links and your daily numbers, from the WhatsApp or Instagram chat you already use. Built for Nigerian service businesses.";

export const metadata: Metadata = {
  title,
  description,
  // The card itself is app/opengraph-image.tsx.
  openGraph: { siteName: "Sara", type: "website", title, description },
};

export default function HomePage() {
  return <LandingPage />;
}
