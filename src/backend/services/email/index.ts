import { env } from "@/env";
import { appBaseUrl } from "@/utils/url";

import { ConsoleEmailSender } from "./console";
import {
  bookingCancelledEmail,
  bookingConfirmedEmail,
  bookingReminderEmail,
  bookingRescheduledEmail,
  invoiceEmail,
  newBookingEmail,
  receiptEmail,
  welcomeEmail,
} from "./messages";
import { ResendEmailSender } from "./resend";
import type { EmailMessage, EmailSender } from "./types";

export type { EmailMessage, EmailSender } from "./types";
export { renderEmail } from "./render";

/** The sender Sara used before EMAIL_FROM existed; kept as the default. */
const DEFAULT_FROM = "Sara <bookings@sara.app>";

export type SendResult = { success: true } | { success: false; error: unknown };

/** A builder's input, less the origin the service supplies. */
type Input<Build extends (input: never) => EmailMessage> = Omit<
  Parameters<Build>[0],
  "origin"
>;

/**
 * Every email Sara sends. Each method builds its message (messages.tsx),
 * hands it to the sender, and reports rather than throws: an email is always
 * a side effect of something that has already happened (a booking, a
 * payment), and must never be what fails it.
 */
class EmailService {
  private sender: EmailSender | undefined;

  /**
   * Resend when RESEND_API_KEY is set, the console otherwise. Chosen on first
   * use, not at import: Resend's constructor throws without a key, and this
   * module is imported during Next's build-time route analysis.
   */
  private get transport(): EmailSender {
    if (this.sender) return this.sender;
    if (env.RESEND_API_KEY) {
      this.sender = new ResendEmailSender(
        env.RESEND_API_KEY,
        env.EMAIL_FROM ?? DEFAULT_FROM,
      );
    } else {
      if (env.NODE_ENV === "production") {
        console.warn(
          "[email] RESEND_API_KEY unset: emails are logged, not delivered",
        );
      }
      this.sender = new ConsoleEmailSender();
    }
    return this.sender;
  }

  private async deliver(
    message: EmailMessage,
    label: string,
  ): Promise<SendResult> {
    try {
      await this.transport.send(message);
      return { success: true };
    } catch (error) {
      console.error(`[email] ${label} email failed:`, error);
      return { success: false, error };
    }
  }

  /** To a new owner, on their first sign-in. */
  sendWelcomeEmail(input: Input<typeof welcomeEmail>) {
    return this.deliver(
      welcomeEmail({ ...input, origin: appBaseUrl() }),
      "welcome",
    );
  }

  /** To the owner, when a customer pays for a booking. */
  sendNewBookingEmail(input: Input<typeof newBookingEmail>) {
    return this.deliver(
      newBookingEmail({ ...input, origin: appBaseUrl() }),
      "new booking",
    );
  }

  sendBookingConfirmationEmail(input: Input<typeof bookingConfirmedEmail>) {
    return this.deliver(
      bookingConfirmedEmail({ ...input, origin: appBaseUrl() }),
      "booking confirmation",
    );
  }

  sendBookingReminderEmail(input: Input<typeof bookingReminderEmail>) {
    return this.deliver(
      bookingReminderEmail({ ...input, origin: appBaseUrl() }),
      "booking reminder",
    );
  }

  sendBookingRescheduledEmail(input: Input<typeof bookingRescheduledEmail>) {
    return this.deliver(
      bookingRescheduledEmail({ ...input, origin: appBaseUrl() }),
      "booking rescheduled",
    );
  }

  sendBookingCancellationEmail(input: Input<typeof bookingCancelledEmail>) {
    return this.deliver(
      bookingCancelledEmail({ ...input, origin: appBaseUrl() }),
      "booking cancellation",
    );
  }

  /** To the customer, when an invoice is sent to them. */
  sendInvoiceEmail(input: Input<typeof invoiceEmail>) {
    return this.deliver(
      invoiceEmail({ ...input, origin: appBaseUrl() }),
      "invoice",
    );
  }

  /** To the customer, when a receipt is issued for their payment. */
  sendReceiptEmail(input: Input<typeof receiptEmail>) {
    return this.deliver(
      receiptEmail({ ...input, origin: appBaseUrl() }),
      "receipt",
    );
  }
}

export const emailService = new EmailService();
