"use client";

import Link from "next/link";
import { useState } from "react";
import type { BusinessProfileDto } from "types";

import { Button, Field, Input, Notice, Segmented, Switch } from "@/primitives";
import type { BusinessUpdateInput } from "@/utils/api";

import { Section } from "./section";

export type SellingInput = Required<
  Pick<
    BusinessUpdateInput,
    "sells" | "offersDelivery" | "deliveryFee" | "offersPickup"
  >
>;

const OPTIONS = [
  { value: "SERVICES", label: "Services" },
  { value: "PRODUCTS", label: "Products" },
  { value: "BOTH", label: "Both" },
] as const;

function feeText(fee: number | null) {
  return fee === null ? "" : String(fee);
}

interface SellingSectionProps {
  profile: BusinessProfileDto;
  onSave: (values: SellingInput, onSaved: () => void) => void;
  isPending: boolean;
  error: string | null;
  saved: boolean;
}

/**
 * What the business sells, and how a product order reaches its customer.
 * Delivery needs one fee (0 is free); pickup needs the business address.
 */
export function SellingSection({
  profile,
  onSave,
  isPending,
  error,
  saved,
}: SellingSectionProps) {
  const [sells, setSells] = useState(profile.sells);
  const [offersDelivery, setOffersDelivery] = useState(profile.offersDelivery);
  const [deliveryFee, setDeliveryFee] = useState(() =>
    feeText(profile.deliveryFee),
  );
  const [offersPickup, setOffersPickup] = useState(profile.offersPickup);
  const [dirty, setDirty] = useState(false);

  // `||`: a blank address counts as none.
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
  const address = profile.address?.trim() || null;
  const cleanedFee = deliveryFee.replace(/[,\s]/g, "");
  const feeIsValid = /^\d+(\.\d{1,2})?$/.test(cleanedFee);
  const feeNeeded = offersDelivery && !feeIsValid;
  const addressNeeded = offersPickup && !address;

  function save() {
    onSave(
      {
        sells,
        offersDelivery,
        deliveryFee: offersDelivery ? Number(cleanedFee) : null,
        offersPickup,
      },
      () => setDirty(false),
    );
  }

  return (
    <Section
      id="selling"
      title="Selling"
      description="What you sell, and how customers get it."
    >
      <div className="grid gap-6">
        <div className="grid gap-1.5">
          <p className="text-ink-2 text-sm leading-[1.3] font-semibold">
            What you sell
          </p>
          <Segmented
            label="What you sell"
            value={sells}
            options={OPTIONS}
            onChange={(value) => {
              setSells(value);
              setDirty(true);
            }}
          />
        </div>

        <div className="grid gap-3">
          <label className="flex cursor-pointer items-center justify-between gap-4 text-[15px] font-semibold">
            Offer delivery
            <Switch
              checked={offersDelivery}
              onCheckedChange={(checked) => {
                setOffersDelivery(checked);
                // Off means no fee is saved, so a later switch-on starts clean.
                if (!checked) setDeliveryFee("");
                setDirty(true);
              }}
              aria-label="Offer delivery"
            />
          </label>

          {offersDelivery ? (
            <Field
              id="selling-delivery-fee"
              label={`Delivery fee (${profile.currency})`}
              hint="One fee for every delivery. Use 0 for free delivery."
            >
              <Input
                inputMode="decimal"
                placeholder="3000"
                value={deliveryFee}
                onChange={(event) => {
                  setDeliveryFee(event.target.value);
                  setDirty(true);
                }}
              />
            </Field>
          ) : null}
        </div>

        <div className="grid gap-2">
          <label className="flex cursor-pointer items-center justify-between gap-4 text-[15px] font-semibold">
            Offer pickup
            <Switch
              checked={offersPickup}
              onCheckedChange={(checked) => {
                setOffersPickup(checked);
                setDirty(true);
              }}
              aria-label="Offer pickup"
            />
          </label>

          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <p className="text-muted min-w-0 text-[15px]">
              {address ?? "No business address yet."}
            </p>
            <Link
              href="/settings#profile-h"
              className="text-accent-ink decoration-accent-tint hover:decoration-accent-ink shrink-0 text-sm font-semibold underline underline-offset-4 transition-colors duration-150"
            >
              Edit in Profile
            </Link>
          </div>
        </div>

        {feeNeeded ? (
          <Notice tone="danger">
            Set a delivery fee, or 0 for free delivery.
          </Notice>
        ) : addressNeeded ? (
          <Notice tone="danger">Add your business address for pickup.</Notice>
        ) : error ? (
          <Notice tone="danger">{error}</Notice>
        ) : null}

        <div className="flex items-center gap-4">
          <Button
            variant="dark"
            isLoading={isPending}
            disabled={isPending || !dirty || feeNeeded || addressNeeded}
            onClick={save}
          >
            Save selling
          </Button>
          {saved && !dirty ? (
            <p className="text-accent-ink text-sm font-semibold" role="status">
              Saved
            </p>
          ) : null}
        </div>
      </div>
    </Section>
  );
}
