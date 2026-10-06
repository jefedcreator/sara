import type { ReactNode } from "react";

import { Wordmark } from "@/primitives";
import { cn } from "@/utils/cn";

/**
 * The frame every customer page shares (services, invoices, receipts,
 * bookings): the business's name where a site name would be, the page, and
 * Sara's quiet single-ink credit at the foot, as on the booking page.
 * `narrow` reads like a document; `wide` is the booking page's width.
 */
export function PublicPage({
  businessName,
  credit,
  width = "narrow",
  className,
  children,
}: {
  businessName: string;
  /** "Bookings", "Invoices", "Receipts": the foot reads "<credit> by sara". */
  credit: string;
  width?: "narrow" | "wide";
  className?: string;
  children: ReactNode;
}) {
  return (
    <main className={cn("bg-canvas text-ink min-h-dvh pb-16", className)}>
      <div
        className={cn(
          "mx-auto px-4 md:px-8",
          width === "narrow" ? "max-w-[640px]" : "max-w-page",
        )}
      >
        <header className="flex h-16 items-center">
          <p className="text-muted truncate text-[15px] font-medium">
            {businessName}
          </p>
        </header>
        {children}
        <footer className="text-faint mt-16 flex items-center gap-2 text-[13px]">
          {credit} by{" "}
          <Wordmark accent={false} className="text-faint text-[17px]" />
        </footer>
      </div>
    </main>
  );
}
