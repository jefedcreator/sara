"use client";

import { CaretLeft, CaretRight } from "@phosphor-icons/react/dist/ssr";

import { Button } from "./Button";

/** Previous / next for a paged list, with where you are. Hidden for one page. */
export function Pager({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <nav aria-label="Pages" className="flex items-center justify-between gap-3">
      <Button
        variant="secondary"
        size="sm"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        <CaretLeft weight="bold" />
        Newer
      </Button>
      <p className="text-muted text-sm">
        Page {page} of {totalPages}
      </p>
      <Button
        variant="secondary"
        size="sm"
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
      >
        Older
        <CaretRight weight="bold" />
      </Button>
    </nav>
  );
}
