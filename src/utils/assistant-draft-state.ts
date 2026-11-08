import type { DraftDto } from "@/types";

/** Reconcile server previews without making an uncertain old draft actionable. */
export function nextAssistantDraftState(
  current: DraftDto | null,
  incoming: DraftDto | null,
  wasEditing: boolean,
  submittedText?: string,
): { draft: DraftDto | null; editing: boolean } {
  const command = submittedText?.trim().toLowerCase();
  if (command === "cancel") {
    return {
      draft: current?.status === "PENDING" ? { ...current, status: "CANCELLED" } : current,
      editing: false,
    };
  }
  if (command === "menu" || command === "0") {
    // The atomic reset reply identifies the surviving draft. Another tab may
    // have replaced or invalidated a card that this panel still holds.
    return { draft: incoming, editing: false };
  }
  // A read/quota/error reply does not cancel a stored pending draft. A failed
  // correction must leave its old summary visible and disabled for approval.
  return {
    draft: incoming ?? current,
    editing: incoming ? wasEditing && incoming.id === current?.id : wasEditing,
  };
}
