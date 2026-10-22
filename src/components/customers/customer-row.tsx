import Link from "next/link";
import type { CustomerListItem } from "types";

import { formatMoney } from "@/utils/format";

interface CustomerRowProps {
  customer: CustomerListItem;
  currency: string;
}

/**
 * One customer: who they are on the left, what they've spent on the right.
 * Only a real debt earns the danger line, so a settled customer stays quiet.
 * The name's link covers the whole row, so the tap target is the row, not one
 * line of text; the phone link sits above it and still dials.
 */
export function CustomerRow({ customer, currency }: CustomerRowProps) {
  return (
    <article className="rounded-card bg-surface relative flex items-start justify-between gap-4 px-4 py-4 sm:px-5">
      <div className="min-w-0">
        <h3 className="text-[16px] leading-snug font-semibold">
          <Link
            href={`/customers/${encodeURIComponent(customer.id)}`}
            className="decoration-accent-tint after:rounded-card underline-offset-4 after:absolute after:inset-0 hover:underline"
          >
            {customer.name}
          </Link>
        </h3>
        {customer.phone ? (
          <a
            href={`tel:${customer.phone}`}
            className="text-muted hover:text-ink relative z-10 mt-0.5 inline-block text-sm underline decoration-accent-tint underline-offset-4"
          >
            {customer.phone}
          </a>
        ) : customer.email ? (
          <p className="text-muted mt-0.5 truncate text-sm">{customer.email}</p>
        ) : null}
        {customer.owes > 0 ? (
          <p className="text-danger mt-1.5 text-sm font-semibold">
            Owes {formatMoney(customer.owes, currency)}
          </p>
        ) : null}
      </div>

      <div className="shrink-0 text-right">
        <p className="text-[16px] font-semibold tabular-nums">
          {formatMoney(customer.spent, currency)}
        </p>
        <p className="text-muted mt-0.5 text-[13px]">spent</p>
      </div>
    </article>
  );
}
