"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/utils/cn";

const LINKS = [
  { href: "#how", label: "How it works" },
  { href: "#booking-links", label: "Booking links" },
  { href: "#invoices", label: "Invoices & receipts" },
  { href: "#pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" },
] as const;

const NAV_LINK =
  "text-[15px] font-medium text-muted no-underline transition-colors duration-200 hover:text-ink";

// Burger lines: the middle bar is the span, the outer two are ::before / ::after.
const BAR =
  "relative block h-[1.5px] w-4 rounded-[2px] transition-colors duration-300 before:absolute before:-top-[5px] before:left-0 before:h-[1.5px] before:w-4 before:rounded-[2px] before:bg-ink before:transition-transform before:duration-300 before:ease-out-expo before:content-[''] after:absolute after:top-[5px] after:left-0 after:h-[1.5px] after:w-4 after:rounded-[2px] after:bg-ink after:transition-transform after:duration-300 after:ease-out-expo after:content-['']";

export function LandingNav({ whatsappHref }: { whatsappHref: string }) {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);

  // Hairline under the bar once the page has moved.
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) =>
      setScrolled(!entry?.isIntersecting),
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const close = () => setOpen(false);

  return (
    <>
      <div
        ref={sentinel}
        className="absolute top-0 left-0 size-px"
        aria-hidden="true"
      />
      <header
        className={cn(
          "bg-canvas/88 sticky top-0 z-20 border-b backdrop-blur-md backdrop-saturate-140 transition-colors duration-300",
          scrolled ? "border-line" : "border-transparent",
        )}
      >
        <div className="max-w-page mx-auto flex h-16 items-center gap-6 px-4 max-[420px]:gap-2.5 md:px-8">
          <a
            className="font-display text-ink text-[26px] leading-none font-semibold tracking-[-0.04em] no-underline [font-variation-settings:'opsz'_48]"
            href="#top"
            aria-label="Sara home"
          >
            sara
          </a>
          <nav
            className="mx-auto hidden gap-7 min-[960px]:flex"
            aria-label="Primary"
          >
            {LINKS.map((l) => (
              <a key={l.href} className={NAV_LINK} href={l.href}>
                {l.label}
              </a>
            ))}
          </nav>
          <Link
            className={cn(NAV_LINK, "hidden min-[960px]:inline")}
            href="/signin"
          >
            Sign in
          </Link>
          <a
            className="bg-accent text-on-accent ease-out-expo hover:bg-accent-hover ml-auto inline-flex h-10 items-center rounded-full px-[18px] text-sm font-semibold whitespace-nowrap no-underline transition-[background-color,scale] duration-200 active:scale-98 max-[420px]:px-3.5 max-[420px]:text-[13px] min-[960px]:ml-0"
            href={whatsappHref}
            target="_blank"
            rel="noopener"
          >
            Start on WhatsApp
          </a>
          <button
            className="bg-surface grid size-10 cursor-pointer place-items-center rounded-full min-[960px]:hidden"
            type="button"
            aria-expanded={open}
            aria-controls="mobile-menu"
            onClick={() => setOpen((v) => !v)}
          >
            <span className="sr-only">Menu</span>
            <span
              aria-hidden="true"
              className={cn(
                BAR,
                open
                  ? "bg-transparent before:translate-y-[5px] before:rotate-45 after:-translate-y-[5px] after:-rotate-45"
                  : "bg-ink",
              )}
            />
          </button>
        </div>
        {open ? (
          <nav
            className="border-line bg-canvas grid border-b px-4 pt-2 pb-5 min-[960px]:hidden md:px-8"
            id="mobile-menu"
            aria-label="Mobile"
          >
            {[...LINKS, { href: "/signin", label: "Sign in" }].map((l) => {
              const cls =
                "border-b border-line py-3 text-[17px] font-medium no-underline last:border-b-0";
              return l.href.startsWith("/") ? (
                <Link
                  key={l.href}
                  className={cls}
                  href={l.href}
                  onClick={close}
                >
                  {l.label}
                </Link>
              ) : (
                <a key={l.href} className={cls} href={l.href} onClick={close}>
                  {l.label}
                </a>
              );
            })}
          </nav>
        ) : null}
      </header>
    </>
  );
}
