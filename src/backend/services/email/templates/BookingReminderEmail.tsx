import {
  CtaButton,
  Details,
  EmailLayout,
  Heading,
  Note,
  Paragraph,
} from "./_components/Layout";

export interface BookingReminderEmailProps {
  origin: string;
  businessName: string;
  serviceName: string;
  /** "Thu 1 Oct at 13:00". */
  when: string;
  /** The business's address, when it has one on file. */
  where: string | null;
  /** The customer's booking page. */
  bookingUrl: string;
  canReply: boolean;
}

/** To the customer, within a day of a confirmed booking. */
export default function BookingReminderEmail(props: BookingReminderEmailProps) {
  const { origin, businessName, serviceName, when, where, bookingUrl, canReply } =
    props;
  return (
    <EmailLayout
      origin={origin}
      sender={{ kind: "business", name: businessName, credit: "Bookings" }}
      preview={`${serviceName} with ${businessName}, ${when}.`}
    >
      <Heading>Your booking is coming up.</Heading>
      <Paragraph>
        {serviceName} with {businessName}, {when}.
      </Paragraph>
      <Details
        rows={[
          { label: "When", value: when, strong: true },
          { label: "Service", value: serviceName },
          ...(where ? [{ label: "Where", value: where }] : []),
        ]}
      />
      <CtaButton href={bookingUrl}>View your booking</CtaButton>
      <Note>
        {canReply
          ? `Running late or can't make it? Reply to this email and it goes to ${businessName}.`
          : `Running late or can't make it? Let ${businessName} know.`}
      </Note>
    </EmailLayout>
  );
}

BookingReminderEmail.PreviewProps = {
  origin: "https://sara.app",
  businessName: "Tolu's Hair Studio",
  serviceName: "Knotless braids",
  when: "Thu 1 Oct at 13:00",
  where: "12 Admiralty Way, Lekki, Lagos",
  bookingUrl: "https://sara.app/bookings/Pq8sN1xV0kL3mA6t",
  canReply: true,
} satisfies BookingReminderEmailProps;
