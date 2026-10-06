import { CaretRight } from "@phosphor-icons/react/dist/ssr";
import Image from "next/image";
import Link from "next/link";

import { PublicPage } from "@/components/public/public-page";
import { Button, LogoMark } from "@/primitives";
import { cn } from "@/utils/cn";
import { servicePath } from "@/utils/public-links";
import {
  BOOK_ACTION,
  servicePriceLine,
  serviceTerms,
  type ServicePage,
} from "@/utils/service-page";

/**
 * A service's public page: the photo, what it is and costs, its terms, and
 * one action into /book, where the customer picks a time and pays. Below,
 * the business's other live services. Phone first: the action rides a
 * bottom bar on phones and sits under the price from `lg`. Without a photo
 * there is no second column, so the page takes the documents' narrow width
 * rather than hugging the left of a wide one.
 */
export function ServiceProfile({ page }: { page: ServicePage }) {
  const action = BOOK_ACTION[page.bookingMode];
  const book = `/book/${encodeURIComponent(page.slug)}`;

  return (
    <PublicPage
      businessName={page.businessName}
      credit="Bookings"
      width={page.image ? "wide" : "narrow"}
      className="pb-32 lg:pb-16"
    >
      <div
        className={cn(
          "grid gap-8 pt-4 lg:items-start lg:gap-16 lg:pt-12",
          page.image && "lg:grid-cols-[1fr_460px]",
        )}
      >
        {page.image ? (
          <div className="rounded-shot bg-surface outline-ink/5 animate-rise relative aspect-[16/10] overflow-hidden outline -outline-offset-1 lg:sticky lg:top-8 lg:order-2 lg:aspect-[4/5]">
            <Image
              src={page.image}
              alt={page.name}
              fill
              sizes="(min-width: 1024px) 460px, 100vw"
              className="object-cover"
              priority
            />
          </div>
        ) : null}

        <section aria-labelledby="service-h" className="animate-rise-1 lg:order-1">
          <h1
            id="service-h"
            className="font-display max-w-[18ch] text-[clamp(2.1rem,1.4rem+3vw,3.4rem)] leading-[1.04] font-[380] tracking-[-0.035em] text-balance"
          >
            {page.name}
          </h1>
          <p className="mt-3 text-[17px] font-semibold">{servicePriceLine(page)}</p>
          <Button asChild size="lg" className="mt-6 hidden lg:inline-flex">
            <Link href={book}>{action}</Link>
          </Button>
          {page.description ? (
            <p className="text-muted mt-6 max-w-[60ch] text-pretty whitespace-pre-line">
              {page.description}
            </p>
          ) : null}
          <dl className="border-line mt-8 grid max-w-[480px] gap-3 border-t pt-6 text-[15px]">
            {serviceTerms(page).map((term) => (
              <div key={term.label} className="flex items-baseline justify-between gap-4">
                <dt className="text-muted">{term.label}</dt>
                <dd className="text-right">{term.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>

      {page.others.length > 0 ? (
        <section aria-labelledby="more-h" className="animate-rise-2 mt-16 lg:mt-24">
          <h2
            id="more-h"
            className="font-display text-[22px] leading-[1.2] font-medium tracking-[-0.02em]"
          >
            More from {page.businessName}
          </h2>
          {/* grid-cols-1 is minmax(0, 1fr): a long name truncates instead of widening the page. */}
          <ul
            className={cn(
              "mt-5 grid grid-cols-1 gap-2.5",
              page.image && "min-[700px]:grid-cols-2",
            )}
          >
            {page.others.map((other) => (
              <li key={other.slug} className="min-w-0">
                <Link
                  href={servicePath(other.slug)}
                  className="rounded-card bg-surface hover:bg-accent-soft flex h-full items-center gap-4 px-4 py-3.5 transition-colors"
                >
                  {/* Every row keeps the slot, so names line up; no photo shows the mark, as the share card does. */}
                  <span className="rounded-chip bg-canvas relative flex size-14 shrink-0 items-center justify-center overflow-hidden">
                    {other.image ? (
                      <Image src={other.image} alt="" fill sizes="56px" className="object-cover" />
                    ) : (
                      <LogoMark accent={false} className="text-line size-7" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{other.name}</span>
                    <span className="text-muted block text-sm">
                      {servicePriceLine({ ...other, currency: page.currency })}
                    </span>
                  </span>
                  <CaretRight weight="bold" className="text-faint size-4 shrink-0" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Phone: the one action, pinned to the bottom edge. */}
      <div className="border-line bg-canvas/92 fixed inset-x-0 bottom-0 z-10 border-t px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md lg:hidden">
        <Button asChild size="lg" className="w-full">
          <Link href={book}>{action}</Link>
        </Button>
      </div>
    </PublicPage>
  );
}
