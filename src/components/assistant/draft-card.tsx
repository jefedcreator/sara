import type { DraftDto, DraftStatus } from "types";

import { Button } from "@/primitives/Button";
import { cn } from "@/utils/cn";

const labels: Record<DraftStatus, string> = {
  PENDING: "Pending approval", APPROVED: "Approved", REPLACED: "Replaced",
  CANCELLED: "Cancelled", EXPIRED: "Expired", INVALID: "Needs a new draft",
};

export function canApproveDraft(draft: DraftDto, editing: boolean, now: Date) {
  return draft.status === "PENDING" && !editing && Date.parse(draft.expiresAt) > now.getTime();
}

export function DraftCard({ draft, busy, editing, now, onApprove, onChange }: {
  draft: DraftDto;
  busy: boolean;
  editing: boolean;
  now: Date;
  onApprove: () => void;
  onChange: () => void;
}) {
  const expired = draft.status === "PENDING" && !(Date.parse(draft.expiresAt) > now.getTime());
  const disabled = busy || !canApproveDraft(draft, editing, now);
  const label = expired ? "Expired" : editing && draft.status === "PENDING" ? "Editing" : labels[draft.status];
  return (
    <section aria-label="Draft for approval" className="bg-surface rounded-card grid min-h-0 shrink gap-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-ink text-sm font-semibold">Review before sending</h3>
        <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", expired ? "bg-canvas text-muted" : "bg-accent-soft text-accent-ink")}>{label}</span>
      </div>
      <p className="text-ink max-h-[20dvh] overflow-y-auto text-sm leading-relaxed whitespace-pre-wrap wrap-anywhere tabular-nums">{draft.summary}</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={disabled} onClick={onApprove}>Send it</Button>
        <Button size="sm" variant="secondary" disabled={disabled} onClick={onChange}>Change something</Button>
      </div>
    </section>
  );
}
