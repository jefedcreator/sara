"use client";

import { SignOut } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Wordmark } from "@/primitives";
import { cn } from "@/utils/cn";

/** Everything the chat menu does, plus the setup the chat can't do. */
const NAV = [
  { href: "/dashboard", label: "Today" },
  { href: "/bookings", label: "Bookings" },
  { href: "/invoices", label: "Invoices" },
  { href: "/receipts", label: "Receipts" },
  { href: "/services", label: "Services" },
  { href: "/settings", label: "Settings" },
] as const;

function NavLinks({ pathname, className }: { pathname: string; className?: string }) {
  return (
    <nav className={className} aria-label="Primary">
      {NAV.map((item) => {
        const active = pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "shrink-0 rounded-full px-3.5 py-2 text-[15px] font-medium whitespace-nowrap no-underline transition-colors duration-200",
              active ? "bg-surface text-ink" : "text-muted hover:text-ink",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * The owner app's top bar. Mounted once by the (app) layout so it survives
 * navigation; only the current marker (from the pathname) changes. Below
 * 1040px the links move to a scrollable second row.
 */
export function AppChrome({ businessName }: { businessName: string }) {
  const pathname = usePathname();

  return (
    <header className="bg-canvas/88 border-line sticky top-0 z-20 border-b backdrop-blur-md backdrop-saturate-140">
      <div className="max-w-page mx-auto flex h-16 items-center gap-3 px-4 md:gap-6 md:px-8">
        <Wordmark href="/dashboard" />
        <NavLinks pathname={pathname} className="mx-auto hidden gap-1 min-[1040px]:flex" />
        <p className="text-muted ml-auto max-w-[22ch] truncate text-sm font-medium min-[1040px]:ml-0">
          {businessName}
        </p>
        <form action="/api/auth/logout" method="post">
          <button
            type="submit"
            aria-label="Sign out"
            title="Sign out"
            className="bg-surface text-ink-2 hover:text-ink ease-out-expo grid size-10 cursor-pointer place-items-center rounded-full transition-[color,scale] duration-200 active:scale-96"
          >
            <SignOut className="size-4" weight="bold" />
          </button>
        </form>
      </div>
      <NavLinks
        pathname={pathname}
        className="-mt-1 flex gap-1 overflow-x-auto px-4 pb-2 [scrollbar-width:none] md:px-8 min-[1040px]:hidden [&::-webkit-scrollbar]:hidden"
      />
    </header>
  );
}
