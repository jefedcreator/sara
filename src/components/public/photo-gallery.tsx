"use client";

import Image from "next/image";
import { useRef, useState } from "react";

import { LogoMark } from "@/primitives";
import { cn } from "@/utils/cn";

/**
 * A product's photos in a square frame the customer swipes through, one
 * scroll-snap slide at a time. Position dots appear only when there is more
 * than one photo, and each is a button that carries the customer to its shot.
 * Without a photo the frame keeps its square and shows the brand mark.
 */
export function PhotoGallery({
  photos,
  name,
  className,
}: {
  photos: string[];
  name: string;
  className?: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  function goTo(index: number) {
    const track = trackRef.current;
    const slide = track?.children[index];
    if (slide instanceof HTMLElement) {
      slide.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "start",
      });
      setActive(index);
    }
  }

  function trackScroll() {
    const track = trackRef.current;
    if (!track || track.clientWidth === 0) return;
    const index = Math.round(track.scrollLeft / track.clientWidth);
    setActive(Math.min(photos.length - 1, Math.max(0, index)));
  }

  return (
    <div className={className}>
      <div
        ref={trackRef}
        onScroll={trackScroll}
        className="rounded-shot bg-surface flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {photos.length > 0 ? (
          photos.map((photo, index) => (
            <div
              key={`${photo}-${index}`}
              className="rounded-shot relative aspect-square w-full shrink-0 snap-center overflow-hidden"
            >
              <Image
                src={photo}
                alt={
                  photos.length > 1
                    ? `${name}, photo ${index + 1} of ${photos.length}`
                    : name
                }
                fill
                sizes="(min-width: 1024px) 460px, 100vw"
                className="object-cover"
                priority={index === 0}
              />
            </div>
          ))
        ) : (
          <div className="rounded-shot bg-surface flex aspect-square w-full shrink-0 snap-center items-center justify-center">
            <LogoMark accent={false} className="text-line size-16" />
          </div>
        )}
      </div>

      {photos.length > 1 ? (
        <div className="mt-2.5 flex justify-center">
          {photos.map((photo, index) => (
            <button
              key={`${photo}-${index}`}
              type="button"
              aria-label={`Photo ${index + 1} of ${photos.length}`}
              aria-current={active === index ? "true" : undefined}
              onClick={() => goTo(index)}
              className="group grid size-7 cursor-pointer place-items-center"
            >
              <span
                className={cn(
                  "size-1.5 rounded-full transition-colors duration-150",
                  active === index ? "bg-ink" : "bg-line group-hover:bg-faint",
                )}
              />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
