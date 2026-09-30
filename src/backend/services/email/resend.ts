import { Resend } from "resend";

import { renderEmail } from "./render";
import type { EmailMessage, EmailSender } from "./types";

/**
 * Delivers through Resend. Takes its credentials as arguments; index.ts is
 * the one place that reads env and decides which sender is in use.
 */
export class ResendEmailSender implements EmailSender {
  private readonly client: Resend;

  constructor(
    apiKey: string,
    private readonly from: string,
  ) {
    this.client = new Resend(apiKey);
  }

  async send(message: EmailMessage): Promise<void> {
    const { html, text } = await renderEmail(message);
    const { error } = await this.client.emails.send({
      from: this.from,
      to: message.to,
      subject: message.subject,
      html,
      text,
      ...(message.replyTo ? { replyTo: message.replyTo } : {}),
    });
    // The SDK reports a rejected send in its return value, not by throwing.
    // Rethrown so a bad key or an unverified domain is seen, not dropped.
    if (error) {
      throw new Error(
        `Resend rejected "${message.subject}": ${error.name}: ${error.message}`,
      );
    }
  }
}
