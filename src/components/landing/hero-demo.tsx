"use client";

import { Pause, Play } from "@phosphor-icons/react/dist/ssr";
import { useCallback, useRef, useState } from "react";

/**
 * The hero's screen recording: a real chat with Sara on WhatsApp, from the menu
 * to "Invoice created", ending on the customer's invoice page
 * (public/landing/hero-demo.mp4, trimmed, staging links blurred). It loops
 * muted like a GIF, but only starts once this mounts with reduced motion off;
 * until then, and wherever the browser refuses to autoplay (iOS Low Power
 * Mode), the poster holds the opening menu. The button pauses it, since it
 * would otherwise never stop moving.
 */
export function HeroDemo() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);

  const attachVideo = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // React sets `muted` as a property, never in the server HTML; autoplay rules read the property.
    el.muted = true;
    el.play().catch(() => undefined);
  }, []);

  const toggle = () => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) el.play().catch(() => undefined);
    else el.pause();
  };

  return (
    <div className="motion-safe:animate-rise-tall relative mx-auto w-[min(320px,70vw)]">
      <div
        className="rounded-shot from-accent-soft to-accent-tint shadow-float aspect-[640/1290] overflow-hidden bg-linear-to-b max-[520px]:rounded-[26px]"
        role="img"
        aria-label="Sara WhatsApp conversation: the numbered menu, then an invoice for Freddie, NGN 10,000 for a wig revamp, with its payment link and the customer's invoice page"
      >
        <video
          ref={attachVideo}
          className="size-full object-cover"
          src="/landing/hero-demo.mp4"
          poster="/landing/hero-demo-poster.jpg"
          muted
          loop
          playsInline
          preload="none"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
        />
      </div>
      <button
        className="bg-ink/80 text-canvas hover:bg-accent-ink ease-out-expo absolute top-3 right-3 grid size-9 cursor-pointer place-items-center rounded-full backdrop-blur-sm transition-[background-color,scale] duration-200 active:scale-97"
        type="button"
        aria-label={playing ? "Pause the demo" : "Play the demo"}
        onClick={toggle}
      >
        {playing ? (
          <Pause size={16} weight="fill" aria-hidden="true" />
        ) : (
          <Play size={16} weight="fill" aria-hidden="true" />
        )}
      </button>
    </div>
  );
}
