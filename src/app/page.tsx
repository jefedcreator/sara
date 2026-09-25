import { type Metadata } from "next";

import { LandingPage } from "@/app/components/landing/LandingPage";

export const metadata: Metadata = {
  title: "Sara · Run your business from WhatsApp",
  description:
    "Invoices, receipts, booking links and your daily numbers, from the WhatsApp or Instagram chat you already use. Built for Nigerian service businesses.",
};

export default function HomePage() {
  return <LandingPage />;
}
