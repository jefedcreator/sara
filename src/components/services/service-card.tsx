import { PencilSimple, Trash } from "@phosphor-icons/react/dist/ssr";
import Image from "next/image";
import type { ServiceDto } from "types";

import { CopyLinkButton } from "@/app/components/landing/CopyLinkButton";
import { Button, LogoMark, Skeleton, StatusPill, Switch } from "@/primitives";
import { cn } from "@/utils/cn";
import { formatDuration, formatMoney, unitNoun } from "@/utils/format";

interface ServiceCardProps {
  service: ServiceDto;
  currency: string;
  link: string;
  isToggling: boolean;
  onEdit: () => void;
  onRemove: () => void;
  onToggle: (isActive: boolean) => void;
}

/**
 * The top of a service card: the service's photo (or the brand mark when
 * unphotographed) in a 16:10 frame, similar to the receipts preview card.
 * Opens the public booking page in a new tab when clicked.
 */
function ServiceImagePreview({
  image,
  name,
  link,
  isActive,
}: {
  image: string | null;
  name: string;
  link: string;
  isActive: boolean;
}) {
  const isCloudinary = Boolean(image?.startsWith("https://res.cloudinary.com"));

  return (
    <a
      href={link}
      target="_blank"
      rel="noopener noreferrer"
      tabIndex={-1}
      aria-hidden="true"
      title={`Open ${name} booking link`}
      className="border-line bg-canvas/40 group/photo relative block aspect-[16/10] cursor-pointer overflow-hidden border-b"
    >
      {image ? (
        <Image
          src={image}
          alt={name}
          fill
          sizes="(min-width: 1040px) 33vw, (min-width: 700px) 50vw, 100vw"
          className={cn(
            "ease-out-expo object-cover transition-transform duration-500 group-hover/card:scale-[1.04]",
            !isActive && "opacity-75 grayscale-[25%]",
          )}
          unoptimized={!isCloudinary}
        />
      ) : (
        <div
          className={cn(
            "bg-surface group-hover/card:bg-canvas flex size-full items-center justify-center transition-colors duration-300",
            !isActive && "opacity-75",
          )}
        >
          <LogoMark
            accent={false}
            className="text-line ease-out-expo size-12 transition-transform duration-500 group-hover/card:scale-110"
          />
        </div>
      )}
    </a>
  );
}

/**
 * One service in the owner's list: the photo preview banner on top, similar
 * to the receipt preview card, followed by the service details, booking link,
 * and management actions.
 */
export function ServiceCard({
  service,
  currency,
  link,
  isToggling,
  onEdit,
  onRemove,
  onToggle,
}: ServiceCardProps) {
  const switchId = `live-${service.id}`;
  const displayUrl = link.replace(/^https?:\/\//, "");

  return (
    <article className="group/card rounded-card bg-surface hover:shadow-card flex h-full flex-col overflow-hidden transition-shadow duration-300">
      <ServiceImagePreview
        image={service.image}
        name={service.name}
        link={link}
        isActive={service.isActive}
      />

      <div className="flex flex-1 flex-col p-4 sm:p-5">
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-display text-[19px] leading-[1.2] font-medium tracking-[-0.02em] break-words">
              {service.name}
            </h3>
            <p className="text-muted mt-1 text-sm">
              {formatMoney(service.price, currency)} ·{" "}
              {service.bookingMode === "SLOT"
                ? formatDuration(service.duration)
                : `per ${unitNoun(service.bookingMode, 1)}`}{" "}
              · {service.availableFrom}–{service.availableTo}
            </p>
            {service.description ? (
              <p className="text-muted mt-1.5 truncate text-[13px]">
                {service.description}
              </p>
            ) : null}
          </div>
          <StatusPill
            tone={service.isActive ? "accent" : "muted"}
            className={!service.isActive ? "bg-canvas" : undefined}
          >
            {service.isActive ? "Live" : "Paused"}
          </StatusPill>
        </header>

        <div
          className={cn(
            "bg-canvas border-line mt-4 flex items-center gap-2 rounded-full border py-1 pr-1 pl-3.5",
            !service.isActive && "opacity-60",
          )}
        >
          <code
            className="text-ink min-w-0 flex-1 truncate font-mono text-[13px]"
            title={link}
          >
            {displayUrl}
          </code>
          <CopyLinkButton url={link} />
        </div>
        {!service.isActive ? (
          <p className="text-muted mt-2 text-[13px]">
            Paused: this link shows customers that it isn&apos;t open.
          </p>
        ) : null}

        <footer className="border-line mt-auto flex items-center gap-2 border-t pt-4">
          <label
            htmlFor={switchId}
            className="text-ink-2 flex cursor-pointer items-center gap-2.5 text-sm font-semibold select-none"
          >
            <Switch
              id={switchId}
              checked={service.isActive}
              disabled={isToggling}
              onCheckedChange={onToggle}
            />
            Taking bookings
          </label>
          <span className="ml-auto flex gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={onEdit}
              aria-label={`Edit ${service.name}`}
            >
              <PencilSimple weight="bold" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={onRemove}
              aria-label={`Delete ${service.name}`}
            >
              <Trash weight="bold" />
            </Button>
          </span>
        </footer>
      </div>
    </article>
  );
}

/** A card's shape while the services list loads: the photo banner, then its lines. */
export function ServiceCardSkeleton() {
  return (
    <div className="rounded-card bg-surface overflow-hidden" aria-hidden="true">
      <div className="border-line aspect-[16/10] border-b">
        <Skeleton className="bg-canvas size-full rounded-none" />
      </div>
      <div className="flex flex-col gap-4 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <Skeleton className="bg-canvas h-5 w-3/5" />
            <Skeleton className="bg-canvas mt-2 h-4 w-4/5" />
          </div>
          <Skeleton className="bg-canvas h-6 w-14 rounded-full" />
        </div>
        <Skeleton className="bg-canvas mt-1 h-9 w-full rounded-full" />
        <div className="border-line mt-2 flex items-center justify-between border-t pt-4">
          <Skeleton className="bg-canvas h-6 w-32 rounded-full" />
          <div className="flex gap-1">
            <Skeleton className="bg-canvas size-10 rounded-full" />
            <Skeleton className="bg-canvas size-10 rounded-full" />
          </div>
        </div>
      </div>
    </div>
  );
}
