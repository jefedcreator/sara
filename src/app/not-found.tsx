import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  CalendarCheck,
  House,
  SquaresFour,
  WhatsappLogo,
} from "@phosphor-icons/react/dist/ssr";

import { ArrowDisc, Button, Wordmark } from "@/primitives";
import { whatsappHref } from "@/utils/whatsapp";

export const metadata: Metadata = {
  title: "Page Not Found · Sara",
  description: "The link you followed could not be found on Sara.",
};

const DESTINATIONS = [
  {
    href: "/dashboard",
    title: "Today's Dashboard",
    description: "Review today's revenue, bookings, and unpaid invoices.",
    icon: SquaresFour,
  },
  {
    href: "/services",
    title: "Services & Booking",
    description: "Share booking links and manage your active services.",
    icon: CalendarCheck,
  },
  {
    href: whatsappHref("Hi Sara, I clicked a link that could not be found."),
    title: "WhatsApp Assistant",
    description: "Send commands or ask for assistance directly in chat.",
    icon: WhatsappLogo,
    external: true,
  },
] as const;

export default function NotFound() {
  const chatUrl = whatsappHref("Hi Sara, I reached a 404 page on the web app.");

  return (
    <div className="bg-canvas text-ink flex min-h-dvh flex-col justify-between">
      {/* Top navigation bar */}
      <header className="border-line/80 border-b">
        <div className="max-w-page mx-auto flex h-16 items-center justify-between px-4 md:px-8">
          <Wordmark href="/" />
          <nav aria-label="Quick links" className="flex items-center gap-3">
            <Link
              href="/"
              className="text-muted hover:text-ink inline-flex items-center gap-1.5 text-[15px] font-medium no-underline transition-colors duration-200"
            >
              <House className="size-4" aria-hidden="true" />
              <span>Home</span>
            </Link>
            <span className="text-line select-none" aria-hidden="true">
              ·
            </span>
            <Link
              href="/dashboard"
              className="text-muted hover:text-ink text-[15px] font-medium no-underline transition-colors duration-200"
            >
              Dashboard
            </Link>
          </nav>
        </div>
      </header>

      {/* Main hero & interactive proof */}
      <main className="max-w-page mx-auto grid w-full flex-1 items-center gap-12 px-4 py-12 md:px-8 md:py-16 lg:grid-cols-[1.12fr_0.88fr] lg:gap-16">
        {/* Left column: Calm headline, guidance, and primary actions */}
        <section className="animate-rise">
          <h1 className="font-display text-[clamp(2.4rem,1.4rem+3.6vw,4.1rem)] leading-[1.04] font-[380] tracking-[-0.04em] text-balance">
            This link could not be found.
          </h1>
          <p className="text-muted mt-5 max-w-[50ch] text-[17px] leading-relaxed text-pretty">
            The page you are looking for does not exist, has expired, or was
            entered with a typo. You can return home, open your dashboard, or
            ask Sara in chat.
          </p>

          <div className="mt-8 flex flex-col gap-3.5 sm:flex-row sm:items-center">
            <Button
              asChild
              size="lg"
              className="w-full justify-between pr-2 sm:w-auto"
            >
              <Link href="/">
                <span>Return home</span>
                <ArrowDisc />
              </Link>
            </Button>
            <Button
              asChild
              variant="secondary"
              size="lg"
              className="w-full sm:w-auto"
            >
              <Link href="/dashboard">Open dashboard</Link>
            </Button>
          </div>

          {/* Quick pathways */}
          <div className="border-line mt-12 border-t pt-8">
            <h2 className="font-display text-ink text-[19px] font-medium tracking-[-0.02em]">
              Useful destinations
            </h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {DESTINATIONS.map((dest) => {
                const Icon = dest.icon;
                const isExternal = "external" in dest && dest.external;

                return (
                  <Link
                    key={dest.title}
                    href={dest.href}
                    target={isExternal ? "_blank" : undefined}
                    rel={isExternal ? "noopener noreferrer" : undefined}
                    className="group border-line bg-surface/70 hover:bg-surface hover:border-line rounded-card flex flex-col justify-between border p-4 no-underline transition-all duration-200 hover:-translate-y-0.5"
                  >
                    <div>
                      <div className="bg-accent-soft text-accent-ink grid size-9 place-items-center rounded-full">
                        <Icon className="size-4.5" aria-hidden="true" />
                      </div>
                      <h3 className="font-display text-ink mt-3 text-[15px] font-medium tracking-[-0.015em]">
                        {dest.title}
                      </h3>
                      <p className="text-muted mt-1 text-[13px] leading-snug">
                        {dest.description}
                      </p>
                    </div>
                    <span className="text-accent-ink mt-3.5 inline-flex items-center gap-1 text-[13px] font-semibold">
                      <span>Visit</span>
                      {isExternal ? (
                        <ArrowUpRight
                          className="size-3.5 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                          aria-hidden="true"
                        />
                      ) : (
                        <ArrowRight
                          className="size-3.5 transition-transform duration-200 group-hover:translate-x-0.5"
                          aria-hidden="true"
                        />
                      )}
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        </section>

        {/* Right column: Signature chat proof */}
        <aside
          aria-label="Sara conversational preview"
          className="animate-rise-1 rounded-panel bg-surface border-line/70 shadow-card flex flex-col gap-5 border p-6 sm:p-8"
        >
          {/* Mock chat header */}
          <div className="border-line/70 flex items-center justify-between border-b pb-3.5">
            <div className="flex items-center gap-2.5">
              <span
                className="bg-accent size-2.5 rounded-full"
                aria-hidden="true"
              />
              <span className="text-ink text-sm font-semibold">
                Sara WhatsApp Assistant
              </span>
            </div>
            <span className="text-faint font-mono text-xs tabular-nums">
              HTTP 404
            </span>
          </div>

          {/* Chat bubbles */}
          <div className="flex flex-col gap-3 py-1">
            {/* Owner sent bubble */}
            <div className="ml-auto max-w-[85%]">
              <p className="rounded-bubble bg-accent text-on-accent shadow-bubble rounded-br-[6px] px-4 py-2.5 text-[14.5px] leading-normal font-medium">
                Where did this page go?
              </p>
              <span className="text-faint mt-1 block text-right text-[11px]">
                Read
              </span>
            </div>

            {/* Sara received bubble */}
            <div className="max-w-[95%]">
              <div className="rounded-bubble border-line bg-canvas shadow-bubble rounded-bl-[6px] border p-4 text-[14.5px] leading-relaxed">
                <p className="text-ink font-normal">
                  Sara: That link is not available. Reply with a number or
                  choose an option below:
                </p>

                <ul className="mt-3.5 grid gap-2" role="list">
                  <li className="flex items-center gap-2.5 text-[14px]">
                    <span
                      className="bg-accent text-on-accent grid size-5.5 place-items-center rounded-full text-xs font-bold"
                      aria-hidden="true"
                    >
                      1
                    </span>
                    <Link
                      href="/"
                      className="text-ink hover:text-accent-ink font-medium underline underline-offset-4 transition-colors"
                    >
                      Return to homepage
                    </Link>
                  </li>
                  <li className="flex items-center gap-2.5 text-[14px]">
                    <span
                      className="bg-accent text-on-accent grid size-5.5 place-items-center rounded-full text-xs font-bold"
                      aria-hidden="true"
                    >
                      2
                    </span>
                    <Link
                      href="/dashboard"
                      className="text-ink hover:text-accent-ink font-medium underline underline-offset-4 transition-colors"
                    >
                      Open your dashboard
                    </Link>
                  </li>
                  <li className="flex items-center gap-2.5 text-[14px]">
                    <span
                      className="bg-accent text-on-accent grid size-5.5 place-items-center rounded-full text-xs font-bold"
                      aria-hidden="true"
                    >
                      3
                    </span>
                    <a
                      href={chatUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-ink hover:text-accent-ink font-medium underline underline-offset-4 transition-colors"
                    >
                      Message Sara on WhatsApp
                    </a>
                  </li>
                </ul>
              </div>
              <span className="text-faint mt-1 block text-[11px]">
                Just now
              </span>
            </div>
          </div>

          {/* Interactive footer action */}
          <a
            href={chatUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="group rounded-chip border-line bg-canvas hover:border-line hover:bg-canvas/90 flex items-center justify-between border px-4 py-3 text-sm no-underline transition-colors duration-200"
          >
            <span className="flex items-center gap-2">
              <WhatsappLogo
                className="text-accent-ink size-4.5"
                aria-hidden="true"
              />
              <span className="text-ink font-medium">
                Need immediate help? Message Sara
              </span>
            </span>
            <ArrowUpRight
              className="text-muted group-hover:text-ink size-4 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
              aria-hidden="true"
            />
          </a>
        </aside>
      </main>

      {/* Calm footer */}
      <footer className="border-line/80 border-t py-6">
        <div className="max-w-page text-muted mx-auto flex flex-wrap items-center justify-between gap-4 px-4 text-sm md:px-8">
          <div className="flex items-center gap-2">
            <span>Bookings and admin by</span>
            <Wordmark accent={false} className="text-faint text-[17px]" />
          </div>
          <p className="text-faint text-xs">
            Run the whole business from the chat you already live in.
          </p>
        </div>
      </footer>
    </div>
  );
}
