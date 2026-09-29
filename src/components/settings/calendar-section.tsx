"use client";

import { useState } from "react";

import { Button, ConfirmModal, Notice, StatusPill } from "@/primitives";

import { Section } from "./section";

interface CalendarSectionProps {
  connectedAt: string | null;
  /** From ?calendar= after Google sends the owner back. */
  returnedWith: "connected" | "failed" | null;
  onConnect: () => void;
  isConnecting: boolean;
  onDisconnect: (onDone: () => void) => void;
  isDisconnecting: boolean;
  error: string | null;
}

export function CalendarSection({
  connectedAt,
  returnedWith,
  onConnect,
  isConnecting,
  onDisconnect,
  isDisconnecting,
  error,
}: CalendarSectionProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const since = connectedAt
    ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" }).format(
        new Date(connectedAt),
      )
    : null;

  return (
    <Section
      id="calendar-h"
      title="Google Calendar"
      description="Confirmed bookings are added to your calendar, cancellations removed and reschedules moved. Busy time on your calendar is never offered to customers."
    >
      {returnedWith === "connected" && connectedAt ? (
        <Notice className="mb-5">Google Calendar is connected.</Notice>
      ) : returnedWith === "failed" ? (
        <Notice tone="danger" className="mb-5">
          Google Calendar didn&apos;t connect. Try again.
        </Notice>
      ) : null}
      {error ? (
        <Notice tone="danger" className="mb-5">
          {error}
        </Notice>
      ) : null}

      {since ? (
        <div className="flex flex-wrap items-center gap-3">
          <StatusPill>Connected</StatusPill>
          <p className="text-muted text-sm">Since {since}</p>
          <Button variant="secondary" size="sm" className="ml-auto" onClick={() => setConfirmOpen(true)}>
            Disconnect
          </Button>
        </div>
      ) : (
        <Button variant="dark" onClick={onConnect} isLoading={isConnecting}>
          Connect Google Calendar
        </Button>
      )}

      <ConfirmModal
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Disconnect Google Calendar?"
        description="New bookings stop appearing on your calendar, and busy time there is no longer blocked on your booking links."
        confirmLabel="Disconnect"
        onConfirm={() => onDisconnect(() => setConfirmOpen(false))}
        isPending={isDisconnecting}
      />
    </Section>
  );
}
