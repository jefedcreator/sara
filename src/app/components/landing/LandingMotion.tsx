"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Page root for the landing page. Content stays visible without JS; once this
 * mounts (and reduced motion is off) it sets [data-motion] on the root, and
 * groups marked [data-arrive] get [data-in] as they scroll into view. Children
 * style themselves against those attributes with Tailwind arbitrary variants
 * (see ARRIVE_ITEM in LandingPage), arriving like messages: owner first,
 * Sara's reply after.
 */
export function LandingMotion({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const groups = el.querySelectorAll<HTMLElement>("[data-arrive]");
    groups.forEach((group) => {
      group
        .querySelectorAll<HTMLElement>("[data-item]")
        .forEach((item, i) => item.style.setProperty("--i", String(i)));
    });

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.setAttribute("data-in", "");
          io.unobserve(entry.target);
        }
      },
      { threshold: 0.25, rootMargin: "0px 0px -8% 0px" },
    );
    groups.forEach((g) => io.observe(g));
    el.setAttribute("data-motion", "");

    return () => io.disconnect();
  }, []);

  return (
    <div ref={root} className="bg-canvas text-ink relative">
      {children}
    </div>
  );
}
