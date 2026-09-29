"use client";

import { SignOut } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Wordmark } from "@/primitives";
import { cn } from "@/utils/cn";

const NAV = [
  { href: "/services", label: "Services" },
  { href: "/settings", label: "Settings" },
] as const;

/**
 * The owner app's top bar. Mounted once by the (app) layout so it survives
 * navigation; only the current marker (from the pathname) changes.
 */
export function AppChrome({ businessName }: { businessName: string }) {
  const pathname = usePathname();

  return (
    <header className="bg-canvas/88 border-line sticky top-0 z-20 border-b backdrop-blur-md backdrop-saturate-140">
      <div className="max-w-page mx-auto flex h-16 items-center gap-3 px-4 md:gap-6 md:px-8">
        <Wordmark href="/services" />
        <nav className="mx-auto flex gap-1" aria-label="Primary">
          {NAV.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-full px-3.5 py-2 text-[15px] font-medium no-underline transition-colors duration-200 sm:px-4",
                  active ? "bg-surface text-ink" : "text-muted hover:text-ink",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <p className="text-muted hidden max-w-[22ch] truncate text-sm font-medium min-[960px]:block">
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
    </header>
  );
}
