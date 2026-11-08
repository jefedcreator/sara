import { renderToStaticMarkup } from "react-dom/server";
import type { DraftDto } from "@/types";
import { describe, expect, it } from "vitest";

import { DraftCard } from "./draft-card";

const draft: DraftDto = {
  id: "a1",
  summary: "Invoice Tolu?\nTotal: NGN 90,000",
  expiresAt: "2026-11-04T10:00:00Z",
  status: "PENDING",
};

function render(overrides: Partial<DraftDto> = {}, editing = false, busy = false) {
  return renderToStaticMarkup(
    <DraftCard draft={{ ...draft, ...overrides }} busy={busy} editing={editing}
      now={new Date("2026-11-04T09:00:00Z")}
      onApprove={() => undefined} onChange={() => undefined} />,
  );
}

describe("DraftCard", () => {
  it("preserves the exact canonical summary and offers explicit approval", () => {
    const html = render();
    expect(html).toContain("Invoice Tolu?\nTotal: NGN 90,000");
    expect(html).toContain("Pending approval");
    expect(html).toContain("Send it");
    expect(html).toContain("Change something");
    expect(html).not.toContain('disabled=""');
  });

  it("disables an expired approval, including the expiry instant", () => {
    for (const now of ["2026-11-04T10:00:00Z", "2026-11-04T10:00:01Z"]) {
      const html = renderToStaticMarkup(<DraftCard draft={draft} busy={false} editing={false}
        now={new Date(now)} onApprove={() => undefined} onChange={() => undefined} />);
      expect(html).toContain("Total: NGN 90,000");
      expect(html).toContain("Expired");
      expect(html.match(/disabled=""/g)).toHaveLength(2);
    }
  });

  it.each(["APPROVED", "REPLACED", "CANCELLED", "INVALID", "EXPIRED"] as const)(
    "keeps a %s draft visible without enabled actions", (status) => {
      const html = render({ status });
      expect(html).toContain("Total: NGN 90,000");
      expect(html.match(/disabled=""/g)).toHaveLength(2);
    },
  );

  it("labels approved and replaced drafts", () => {
    expect(render({ status: "APPROVED" })).toContain("Approved");
    expect(render({ status: "REPLACED" })).toContain("Replaced");
  });

  it("blocks stale approval while editing, busy or carrying an invalid expiry", () => {
    expect(render({}, true)).toContain("Editing");
    for (const html of [render({}, true), render({}, false, true), render({ expiresAt: "invalid" })]) {
      expect(html.match(/disabled=""/g)).toHaveLength(2);
    }
  });

  it("escapes the canonical summary", () => {
    const html = render({ summary: "<script>alert('owner')</script>" });
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
});
