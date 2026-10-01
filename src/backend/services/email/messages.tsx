// One builder per email: recipient, subject and reply-to beside the template
// that draws the body. Pure: they take the origin and the facts and format
// them; they read neither env nor the database.

import type { BookingMode } from "@prisma/client";

import {
  bookingSpan,
  bookingWhen,
  formatDuration,
  formatMoney,
  formatSlotMoment,
  unitCount,
} from "@/utils/format";
import { formatDate } from "@/utils/labels";

import BookingCancelledEmail from "./templates/BookingCancelledEmail";
import BookingConfirmedEmail from "./templates/BookingConfirmedEmail";
import BookingReminderEmail from "./templates/BookingReminderEmail";
import BookingRescheduledEmail from "./templates/BookingRescheduledEmail";
import InvoiceEmail from "./templates/InvoiceEmail";
import NewBookingEmail from "./templates/NewBookingEmail";
import ReceiptEmail from "./templates/ReceiptEmail";
import WelcomeEmail from "./templates/WelcomeEmail";
import type { EmailMessage } from "./types";

type Money = number | string;

/** The business an email to its customer is sent for. */
export interface BusinessSender {
  name: string;
  /** Its contact address: replies go here when there is one. */
  email?: string | null;
}

/** Slot times are wall-clock UTC (utils/format.ts): "Thu 1 Oct at 13:00". */
const when = (startTime: Date) => formatSlotMoment(startTime.toISOString());

/** A stay or rental's end and length; slot bookings leave it out. */
export interface BookingSpanInput {
  bookingMode: BookingMode;
  endTime: Date;
  units: number;
}

const times = (startTime: Date, span: BookingSpanInput) => ({
  bookingMode: span.bookingMode,
  startTime: startTime.toISOString(),
  endTime: span.endTime.toISOString(),
  units: span.units,
});
const isUnitSpan = (span?: BookingSpanInput): span is BookingSpanInput =>
  Boolean(span && span.bookingMode !== "SLOT");

/** The body's "when": full check-in/check-out or pickup/return wording for stays and rentals. */
const whenOf = (startTime: Date, span?: BookingSpanInput) =>
  isUnitSpan(span) ? bookingWhen(times(startTime, span)) : when(startTime);

/** The subject line's "when": compact for stays and rentals. */
const subjectWhen = (startTime: Date, span?: BookingSpanInput) =>
  isUnitSpan(span) ? bookingSpan(times(startTime, span)) : when(startTime);

function fromBusiness(business: BusinessSender) {
  return business.email
    ? { replyTo: business.email, canReply: true }
    : { canReply: false };
}

export function welcomeEmail(input: {
  origin: string;
  to: string;
  name: string | null;
}): EmailMessage {
  return {
    to: input.to,
    subject: "Welcome to Sara",
    body: <WelcomeEmail origin={input.origin} name={input.name} />,
  };
}

export function newBookingEmail(input: {
  origin: string;
  to: string;
  clientName: string;
  clientEmail: string | null;
  clientPhone: string | null;
  serviceName: string;
  startTime: Date;
  amount: Money;
  currency: string;
  span?: BookingSpanInput;
}): EmailMessage {
  return {
    to: input.to,
    subject: `New booking: ${input.clientName}, ${input.serviceName}, ${subjectWhen(input.startTime, input.span)}`,
    body: (
      <NewBookingEmail
        origin={input.origin}
        clientName={input.clientName}
        clientEmail={input.clientEmail}
        clientPhone={input.clientPhone}
        serviceName={input.serviceName}
        when={whenOf(input.startTime, input.span)}
        paid={formatMoney(input.amount, input.currency)}
      />
    ),
  };
}

export function bookingConfirmedEmail(input: {
  origin: string;
  to: string;
  business: BusinessSender;
  serviceName: string;
  startTime: Date;
  /** Minutes. */
  duration: number;
  amount: Money | null;
  currency: string;
  receiptUrl: string | null;
  span?: BookingSpanInput;
}): EmailMessage {
  const { replyTo, canReply } = fromBusiness(input.business);
  return {
    to: input.to,
    replyTo,
    subject: `Your booking with ${input.business.name} is confirmed`,
    body: (
      <BookingConfirmedEmail
        origin={input.origin}
        businessName={input.business.name}
        serviceName={input.serviceName}
        when={whenOf(input.startTime, input.span)}
        duration={
          isUnitSpan(input.span)
            ? unitCount(input.span.bookingMode, input.span.units)
            : formatDuration(input.duration)
        }
        paid={
          input.amount === null
            ? null
            : formatMoney(input.amount, input.currency)
        }
        receiptUrl={input.receiptUrl}
        canReply={canReply}
      />
    ),
  };
}

export function bookingReminderEmail(input: {
  origin: string;
  to: string;
  business: BusinessSender & {
    address?: string | null;
    city?: string | null;
    state?: string | null;
  };
  serviceName: string;
  startTime: Date;
  span?: BookingSpanInput;
}): EmailMessage {
  const { replyTo, canReply } = fromBusiness(input.business);
  const where = [
    input.business.address,
    input.business.city,
    input.business.state,
  ]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(", ");
  const at = subjectWhen(input.startTime, input.span);
  return {
    to: input.to,
    replyTo,
    subject: `Reminder: ${input.serviceName} with ${input.business.name}, ${at}`,
    body: (
      <BookingReminderEmail
        origin={input.origin}
        businessName={input.business.name}
        serviceName={input.serviceName}
        when={whenOf(input.startTime, input.span)}
        where={where || null}
        canReply={canReply}
      />
    ),
  };
}

export function bookingRescheduledEmail(input: {
  origin: string;
  to: string;
  business: BusinessSender;
  serviceName: string;
  previousStartTime: Date;
  newStartTime: Date;
  span?: BookingSpanInput;
  previousSpan?: BookingSpanInput;
}): EmailMessage {
  const { replyTo, canReply } = fromBusiness(input.business);
  const at = subjectWhen(input.newStartTime, input.span);
  return {
    to: input.to,
    replyTo,
    subject: `Your booking with ${input.business.name} has moved to ${at}`,
    body: (
      <BookingRescheduledEmail
        origin={input.origin}
        businessName={input.business.name}
        serviceName={input.serviceName}
        previousWhen={whenOf(input.previousStartTime, input.previousSpan)}
        when={whenOf(input.newStartTime, input.span)}
        canReply={canReply}
      />
    ),
  };
}

export function bookingCancelledEmail(input: {
  origin: string;
  to: string;
  business: BusinessSender;
  serviceName: string;
  serviceSlug: string;
  startTime: Date;
  span?: BookingSpanInput;
}): EmailMessage {
  const { replyTo, canReply } = fromBusiness(input.business);
  return {
    to: input.to,
    replyTo,
    subject: `Your booking with ${input.business.name} was cancelled`,
    body: (
      <BookingCancelledEmail
        origin={input.origin}
        businessName={input.business.name}
        serviceName={input.serviceName}
        when={whenOf(input.startTime, input.span)}
        bookUrl={`${input.origin}/book/${encodeURIComponent(input.serviceSlug)}`}
        canReply={canReply}
      />
    ),
  };
}

export function invoiceEmail(input: {
  origin: string;
  to: string;
  business: BusinessSender;
  customerName: string | null;
  number: string;
  total: Money;
  amountPaid: Money;
  currency: string;
  dueAt: Date | null;
  url: string;
}): EmailMessage {
  const { replyTo, canReply } = fromBusiness(input.business);
  const balance = Math.max(0, Number(input.total) - Number(input.amountPaid));
  return {
    to: input.to,
    replyTo,
    subject: `Invoice ${input.number} from ${input.business.name}`,
    body: (
      <InvoiceEmail
        origin={input.origin}
        businessName={input.business.name}
        customerName={input.customerName}
        number={input.number}
        total={formatMoney(input.total, input.currency)}
        balance={
          Number(input.amountPaid) > 0
            ? formatMoney(balance, input.currency)
            : null
        }
        dueDate={input.dueAt ? formatDate(input.dueAt.toISOString()) : null}
        url={input.url}
        canReply={canReply}
      />
    ),
  };
}

export function receiptEmail(input: {
  origin: string;
  to: string;
  business: BusinessSender;
  customerName: string | null;
  number: string;
  amountPaid: Money;
  currency: string;
  issuedAt: Date;
  /** "Bank transfer", already labelled. */
  method: string | null;
  url: string;
}): EmailMessage {
  const { replyTo } = fromBusiness(input.business);
  return {
    to: input.to,
    replyTo,
    subject: `Receipt ${input.number} from ${input.business.name}`,
    body: (
      <ReceiptEmail
        origin={input.origin}
        businessName={input.business.name}
        customerName={input.customerName}
        number={input.number}
        paid={formatMoney(input.amountPaid, input.currency)}
        date={formatDate(input.issuedAt.toISOString())}
        method={input.method}
        url={input.url}
      />
    ),
  };
}
