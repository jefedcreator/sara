import {
  CtaButton,
  Details,
  EmailLayout,
  Heading,
  Note,
  Paragraph,
  Pill,
} from "./_components/Layout";

export interface BookingCancelledEmailProps {
  origin: string;
  businessName: string;
  serviceName: string;
  /** "Thu 1 Oct at 13:00". */
  when: string;
  /** The service's booking page, to pick another time. */
  bookUrl: string;
  canReply: boolean;
}

/** To the customer, when their booking is cancelled. */
export default function BookingCancelledEmail(
  props: BookingCancelledEmailProps,
) {
  const { origin, businessName, serviceName, when, bookUrl, canReply } = props;
  return (
    <EmailLayout
      origin={origin}
      sender={{ kind: "business", name: businessName, credit: "Bookings" }}
      preview={`${serviceName} with ${businessName}, ${when}, was cancelled.`}
    >
      <Pill tone="muted">Cancelled</Pill>
      <Heading>Your booking was cancelled.</Heading>
      <Paragraph>
        {serviceName} with {businessName}, {when}, won&apos;t go ahead. If
        you&apos;d still like to come, pick another time.
      </Paragraph>
      <Details
        rows={[
          { label: "Service", value: serviceName },
          { label: "Was", value: when, struck: true },
        ]}
      />
      <CtaButton href={bookUrl}>Pick another time</CtaButton>
      <Note>
        {canReply
          ? `Questions about a payment? Reply to this email and it goes to ${businessName}.`
          : `Questions about a payment? Contact ${businessName} directly.`}
      </Note>
    </EmailLayout>
  );
}

BookingCancelledEmail.PreviewProps = {
  origin: "https://sara.app",
  businessName: "Tolu's Hair Studio",
  serviceName: "Knotless braids",
  when: "Thu 1 Oct at 13:00",
  bookUrl: "https://sara.app/book/tolus-hair-studio-knotless-braids",
  canReply: true,
} satisfies BookingCancelledEmailProps;
