import { PencilSimple, Trash } from "@phosphor-icons/react/dist/ssr";
import type { ServiceDto } from "types";

import { CopyLinkButton } from "@/app/components/landing/CopyLinkButton";
import { Button, StatusPill, Switch } from "@/primitives";
import { cn } from "@/utils/cn";
import { formatDuration, formatMoney } from "@/utils/format";

interface ServiceCardProps {
  service: ServiceDto;
  currency: string;
  bookingUrl: string;
  isToggling: boolean;
  onEdit: () => void;
  onRemove: () => void;
  onToggle: (isActive: boolean) => void;
}

/** One service: its label, its booking link, and what can be done to it. */
export function ServiceCard({
  service,
  currency,
  bookingUrl,
  isToggling,
  onEdit,
  onRemove,
  onToggle,
}: ServiceCardProps) {
  const switchId = `live-${service.id}`;
  const displayUrl = bookingUrl.replace(/^https?:\/\//, "");

  return (
    <article className="rounded-panel bg-surface flex flex-col px-[18px] pt-[22px] pb-5">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-display text-[19px] leading-[1.2] font-medium tracking-[-0.02em] break-words">
            {service.name}
          </h3>
          <p className="text-muted mt-1 text-sm">
            {formatMoney(service.price, currency)} · {formatDuration(service.duration)} ·{" "}
            {service.availableFrom}–{service.availableTo}
          </p>
        </div>
        <StatusPill tone={service.isActive ? "accent" : "muted"}>
          {service.isActive ? "Live" : "Paused"}
        </StatusPill>
      </header>

      <div
        className={cn(
          "bg-canvas border-line mt-5 flex items-center gap-2 rounded-full border py-1 pr-1 pl-4",
          !service.isActive && "opacity-60",
        )}
      >
        <code className="text-ink min-w-0 flex-1 truncate font-mono text-[13px]" title={bookingUrl}>
          {displayUrl}
        </code>
        <CopyLinkButton url={bookingUrl} />
      </div>
      {!service.isActive ? (
        <p className="text-muted mt-2 text-[13px]">Paused: this link shows customers that it isn&apos;t open.</p>
      ) : null}

      <footer className="border-line mt-5 flex items-center gap-2 border-t pt-4">
        <label htmlFor={switchId} className="text-ink-2 flex cursor-pointer items-center gap-2.5 text-sm font-semibold">
          <Switch
            id={switchId}
            checked={service.isActive}
            disabled={isToggling}
            onCheckedChange={onToggle}
          />
          Taking bookings
        </label>
        <span className="ml-auto flex gap-1">
          <Button variant="ghost" size="icon" onClick={onEdit} aria-label={`Edit ${service.name}`}>
            <PencilSimple weight="bold" />
          </Button>
          <Button variant="ghost" size="icon" onClick={onRemove} aria-label={`Delete ${service.name}`}>
            <Trash weight="bold" />
          </Button>
        </span>
      </footer>
    </article>
  );
}
