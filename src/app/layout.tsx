import "@/styles/globals.css";

import { type Metadata } from "next";
import { Bricolage_Grotesque, Hanken_Grotesk } from "next/font/google";

import { Provider } from "@/provider";

export const metadata: Metadata = {
  title: "Sara",
  description:
    "Run your business from the WhatsApp or Instagram chat you already use.",
  icons: [{ rel: "icon", url: "/favicon.ico" }],
};

// Type pairing from DESIGN.md: Bricolage Grotesque (display) + Hanken Grotesk (UI).
const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  axes: ["opsz"],
  variable: "--font-bricolage",
});

const hanken = Hanken_Grotesk({
  subsets: ["latin"],
  variable: "--font-hanken",
});

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${bricolage.variable} ${hanken.variable}`}>
      <body>
        <Provider>{children}</Provider>
      </body>
    </html>
  );
}
