import type { DraftDto } from "@/types";
import { describe, expect, it } from "vitest";

import { nextAssistantDraftState } from "./assistant-draft-state";

const draft: DraftDto = {
  id: "a1", summary: "Create an invoice for Amaka?\nTotal: NGN 15,000",
  expiresAt: "2026-11-07T12:00:00Z", status: "PENDING",
};

describe("assistant preview reconciliation", () => {
  it("labels a cancelled pending summary and removes approval eligibility", () => {
    expect(nextAssistantDraftState(draft, null, false, " CANCEL ")).toEqual({
      draft: { ...draft, status: "CANCELLED" }, editing: false,
    });
  });
  it("does not rewrite an already approved draft as cancelled", () => {
    const approved = { ...draft, status: "APPROVED" } as const;
    expect(nextAssistantDraftState(approved, null, false, "cancel").draft).toEqual(approved);
  });
  it.each(["menu", " 0 "])("uses the surviving server draft after %s and leaves edit mode", (command) => {
    expect(nextAssistantDraftState(draft, draft, true, command)).toEqual({ draft, editing: false });
    expect(nextAssistantDraftState(draft, null, true, command)).toEqual({ draft: null, editing: false });
  });
  it("keeps a pending draft available after an unrelated read or recoverable error", () => {
    expect(nextAssistantDraftState(draft, null, false, "What is unpaid?")).toEqual({ draft, editing: false });
  });
  it("keeps a failed correction's canonical old summary visible and disabled", () => {
    expect(nextAssistantDraftState(draft, null, true, "Change the price")).toEqual({ draft, editing: true });
    expect(nextAssistantDraftState(draft, draft, true, "Try the correction again")).toEqual({ draft, editing: true });
  });
  it("enables a newly rendered replacement only after the response arrives", () => {
    const replacement = { ...draft, id: "a2", summary: "Create an invoice?\nTotal: NGN 20,000" };
    expect(nextAssistantDraftState(draft, replacement, true, "Use 20,000")).toEqual({ draft: replacement, editing: false });
  });
  it("does not interpret natural language or a voice transcript as a control", () => {
    expect(nextAssistantDraftState(draft, null, true, "cancel the last line")).toEqual({ draft, editing: true });
    expect(nextAssistantDraftState(draft, null, true)).toEqual({ draft, editing: true });
  });
});
