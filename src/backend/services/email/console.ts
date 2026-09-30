import { renderEmail } from "./render";
import type { EmailMessage, EmailSender } from "./types";

/**
 * Prints the message instead of sending it: local development, tests, and
 * any deploy without RESEND_API_KEY. Every flow stays exercisable; the links
 * can be copied out of the log.
 */
export class ConsoleEmailSender implements EmailSender {
  async send(message: EmailMessage): Promise<void> {
    const { text } = await renderEmail(message);
    console.log(
      [
        "",
        "──── email (not sent: console sender) ────",
        `to:      ${message.to}`,
        ...(message.replyTo ? [`reply:   ${message.replyTo}`] : []),
        `subject: ${message.subject}`,
        "",
        text,
        "──────────────────────────────────────────",
        "",
      ].join("\n"),
    );
  }
}
