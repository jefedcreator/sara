import {
  CtaButton,
  Details,
  EmailLayout,
  Heading,
  Note,
  Paragraph,
  Pill,
} from "./_components/Layout";

export interface BookingConfirmedEmailProps {
  origin: string;
  businessName: string;
  serviceName: string;
  /** "Thu 1 Oct at 13:00". */
  when: string;
  /** "4 hr". */
  duration: string;
  /** "NGN 25,000", or null for a free booking. */
  paid: string | null;
  /** The receipt's share page, when one was issued. */
  receiptUrl: string | null;
  /** Whether a reply reaches the business (it has an email on file). */
  canReply: boolean;
}

/** To the customer, once Paystack confirms their payment. */
export default function BookingConfirmedEmail(
  props: BookingConfirmedEmailProps,
) {
  const {
    origin,
    businessName,
    serviceName,
    when,
    duration,
    paid,
    receiptUrl,
    canReply,
  } = props;
  return (
    <EmailLayout
      origin={origin}
      sender={{ kind: "business", name: businessName, credit: "Bookings" }}
      preview={`${serviceName} with ${businessName}, ${when}.`}
    >
      <Pill>Confirmed</Pill>
      <Heading>You&apos;re booked.</Heading>
      <Paragraph>
        See you {when}. You&apos;ll get a reminder the day before.
      </Paragraph>
      <Details
        rows={[
          { label: "When", value: when, strong: true },
          { label: "Service", value: serviceName },
          { label: "Length", value: duration },
          ...(paid ? [{ label: "Paid", value: paid }] : []),
        ]}
      />
      {receiptUrl ? (
        <CtaButton href={receiptUrl}>View your receipt</CtaButton>
      ) : null}
      <Note>
        {canReply
          ? `Need to change something? Reply to this email and it goes to ${businessName}.`
          : `Need to change something? Contact ${businessName} directly.`}
      </Note>
    </EmailLayout>
  );
}

BookingConfirmedEmail.PreviewProps = {
  origin: "https://sara.app",
  businessName: "Tolu's Hair Studio",
  serviceName: "Knotless braids",
  when: "Thu 1 Oct at 13:00",
  duration: "4 hr",
  paid: "NGN 25,000",
  receiptUrl: "https://sara.app/r/tolus-hair-studio-rcp-1007/preview",
  canReply: true,
} satisfies BookingConfirmedEmailProps;
