"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import s from "./landing.module.css";

const LINKS = [
  { href: "#how", label: "How it works" },
  { href: "#booking-links", label: "Booking links" },
  { href: "#invoices", label: "Invoices & receipts" },
  { href: "#pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" },
] as const;

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
      <div ref={sentinel} className={s.sentinel} aria-hidden="true" />
      <header className={`${s.nav} ${scrolled ? s.navScrolled : ""}`}>
        <div className={s.navInner}>
          <a className={s.wordmark} href="#top" aria-label="Sara home">
            sara
          </a>
          <nav className={s.navLinks} aria-label="Primary">
            {LINKS.map((l) => (
              <a key={l.href} href={l.href}>
                {l.label}
              </a>
            ))}
          </nav>
          <Link className={s.signIn} href="/sign-in">
            Sign in
          </Link>
          <a
            className={`${s.btn} ${s.btnSm} ${s.navCta}`}
            href={whatsappHref}
            target="_blank"
            rel="noopener"
          >
            Start on WhatsApp
          </a>
          <button
            className={s.menuBtn}
            type="button"
            aria-expanded={open}
            aria-controls="mobile-menu"
            onClick={() => setOpen((v) => !v)}
          >
            <span className={s.sr}>Menu</span>
            <span className={s.bars} aria-hidden="true" />
          </button>
        </div>
        {open ? (
          <nav className={s.mobileMenu} id="mobile-menu" aria-label="Mobile">
            {LINKS.map((l) => (
              <a key={l.href} href={l.href} onClick={close}>
                {l.label}
              </a>
            ))}
            <Link href="/sign-in" onClick={close}>
              Sign in
            </Link>
          </nav>
        ) : null}
      </header>
    </>
  );
}
