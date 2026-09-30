import type { ReactElement } from "react";

/**
 * One email. The body is a React Email element, the single source of both
 * the HTML and the plain-text part (render.ts), so the two can't drift.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  body: ReactElement;
  /** Where a reply goes: the business, on emails sent for one. */
  replyTo?: string;
}

export interface EmailSender {
  /** Resolves once the provider has accepted the message; throws otherwise. */
  send(message: EmailMessage): Promise<void>;
}
