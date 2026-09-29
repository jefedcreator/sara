"use client";

import { Plus } from "@phosphor-icons/react/dist/ssr";
import { useState } from "react";
import type { ServiceDto } from "types";

import type { ServiceFormOutput } from "@/backend/validators/service-form.validator";
import {
  useCreateServiceMutation,
  useRemoveServiceMutation,
  useUpdateServiceMutation,
} from "@/hooks/mutations/use-service-mutations";
import { useServicesQuery } from "@/hooks/queries/use-services";
import { Button, ConfirmModal, Notice } from "@/primitives";
import { errorMessage } from "@/utils/axios";

import { ServiceCard } from "./service-card";
import { ServiceModal } from "./service-modal";

interface ServicesPageClientProps {
  initialServices: ServiceDto[];
  currency: string;
  /** `https://app.sara.ng/book` — a service's link is this plus its slug. */
  bookingBaseUrl: string;
  isPaymentReady: boolean;
}

type Editing = { key: number; service?: ServiceDto };

export function ServicesPageClient({
  initialServices,
  currency,
  bookingBaseUrl,
  isPaymentReady,
}: ServicesPageClientProps) {
  const { data: services = initialServices } = useServicesQuery(initialServices);
  const create = useCreateServiceMutation();
  const update = useUpdateServiceMutation();
  const remove = useRemoveServiceMutation();

  // The modal stays mounted while it animates out; `key` gives each opening
  // a fresh form. `open` is separate so closing keeps the last service.
  const [editing, setEditing] = useState<Editing>({ key: 0 });
  const [modalOpen, setModalOpen] = useState(false);
  // Kept after closing so the title doesn't change while the modal animates out.
  const [removing, setRemoving] = useState<ServiceDto | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const saving = editing.service ? update : create;

  function openEditor(service?: ServiceDto) {
    create.reset();
    update.reset();
    setEditing((prev) => ({ key: prev.key + 1, service }));
    setModalOpen(true);
  }

  function save(values: ServiceFormOutput, image?: File) {
    const input = { ...values, description: values.description || undefined };
    const onSuccess = () => setModalOpen(false);

    const current = editing.service;
    if (!current) {
      create.mutate({ values: input, image }, { onSuccess });
      return;
    }
    // A rename moves the booking link, so the name is only sent when it changed.
    const { name, ...rest } = input;
    update.mutate(
      {
        slug: current.slug,
        values: name === current.name ? rest : input,
        image,
      },
      { onSuccess },
    );
  }

  function toggle(service: ServiceDto, isActive: boolean) {
    setToggling(service.id);
    update.mutate(
      { slug: service.slug, values: { isActive } },
      {
        onError: (error) => setNotice(errorMessage(error)),
        onSettled: () => setToggling(null),
      },
    );
  }

  function confirmRemove() {
    if (!removing) return;
    remove.mutate(removing.slug, {
      onSuccess: ({ paused }) => {
        setNotice(
          paused
            ? `${removing.name} has bookings or invoices, so it was paused instead of deleted.`
            : null,
        );
        setConfirmOpen(false);
      },
    });
  }

  return (
    <div className="grid gap-8">
      <header className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <h1 className="font-display text-[clamp(1.9rem,1.3rem+2.2vw,3rem)] leading-[1.06] font-normal tracking-[-0.035em]">
            Services
          </h1>
          <p className="text-muted mt-2 max-w-[52ch] text-pretty">
            Each service has a booking link. Put it in your bio, or reply{" "}
            <b className="text-ink font-semibold">3</b> in your Sara chat to share one.
          </p>
        </div>
        {services.length > 0 ? (
          <Button onClick={() => openEditor()}>
            <Plus weight="bold" />
            Add a service
          </Button>
        ) : null}
      </header>

      {!isPaymentReady ? (
        <Notice tone="danger">
          Your bank account isn&apos;t linked, so booking links can&apos;t take payments yet.
        </Notice>
      ) : null}
      {notice ? <Notice tone="neutral">{notice}</Notice> : null}

      {services.length === 0 ? (
        <section className="rounded-panel bg-surface grid gap-6 px-5 py-8 sm:px-8 md:grid-cols-[1fr_320px] md:items-center">
          <div>
            <h2 className="font-display text-[22px] leading-[1.2] font-medium tracking-[-0.02em]">
              Add your first service.
            </h2>
            <p className="text-muted mt-2 max-w-[44ch] text-pretty">
              Give it a name, a price and how long it takes. Sara turns it into a
              booking link that only offers your free time.
            </p>
            <Button className="mt-6" onClick={() => openEditor()}>
              <Plus weight="bold" />
              Add a service
            </Button>
          </div>
          <div className="grid gap-2" aria-hidden="true">
            <p className="rounded-bubble bg-accent text-on-accent ml-auto w-fit rounded-br-[6px] px-3.5 py-2.5 text-[14.5px] font-medium">
              3
            </p>
            <p className="rounded-bubble border-line bg-canvas shadow-bubble w-fit max-w-full rounded-bl-[6px] border px-3.5 py-2.5 text-[14.5px] leading-normal">
              Here&apos;s your booking link for Knotless braids — NGN 25,000 (4 hr).
              <span className="rounded-chip bg-accent-soft text-accent-ink mt-2 block px-2.5 py-[7px] text-[13px] font-semibold">
                app.sara.ng/book/knotless-braids
              </span>
            </p>
          </div>
        </section>
      ) : (
        <ul className="grid gap-4 min-[700px]:grid-cols-2 min-[1040px]:grid-cols-3">
          {services.map((service) => (
            <li key={service.id} className="grid">
              <ServiceCard
                service={service}
                currency={currency}
                bookingUrl={`${bookingBaseUrl}/${service.slug}`}
                isToggling={toggling === service.id}
                onEdit={() => openEditor(service)}
                onRemove={() => {
                  remove.reset();
                  setRemoving(service);
                  setConfirmOpen(true);
                }}
                onToggle={(isActive) => toggle(service, isActive)}
              />
            </li>
          ))}
        </ul>
      )}

      <ServiceModal
        key={editing.key}
        open={modalOpen}
        onOpenChange={setModalOpen}
        service={editing.service}
        currency={currency}
        onSubmit={save}
        isPending={saving.isPending}
        error={saving.isError ? errorMessage(saving.error) : null}
      />

      <ConfirmModal
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={removing ? `Delete ${removing.name}?` : "Delete service?"}
        description={
          remove.isError
            ? errorMessage(remove.error)
            : "Its booking link stops working. If it has bookings or invoices it is paused instead, so your history stays intact."
        }
        confirmLabel="Delete service"
        tone="danger"
        onConfirm={confirmRemove}
        isPending={remove.isPending}
      />
    </div>
  );
}
