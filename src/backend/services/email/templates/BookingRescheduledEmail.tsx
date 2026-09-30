import {
  Details,
  EmailLayout,
  Heading,
  Note,
  Paragraph,
  Pill,
} from "./_components/Layout";

export interface BookingRescheduledEmailProps {
  origin: string;
  businessName: string;
  serviceName: string;
  /** Both "Thu 1 Oct at 13:00". */
  previousWhen: string;
  when: string;
  canReply: boolean;
}

/** To the customer, when the business moves their booking. */
export default function BookingRescheduledEmail(
  props: BookingRescheduledEmailProps,
) {
  const { origin, businessName, serviceName, previousWhen, when, canReply } =
    props;
  return (
    <EmailLayout
      origin={origin}
      sender={{ kind: "business", name: businessName, credit: "Bookings" }}
      preview={`${serviceName} with ${businessName} is now ${when}.`}
    >
      <Pill>New time</Pill>
      <Heading>Your booking has moved.</Heading>
      <Paragraph>
        {businessName} moved your {serviceName} to {when}. Everything else stays
        the same.
      </Paragraph>
      <Details
        rows={[
          { label: "Now", value: when, strong: true },
          { label: "Was", value: previousWhen, struck: true },
          { label: "Service", value: serviceName },
        ]}
      />
      <Note>
        {canReply
          ? `If the new time doesn't work, reply to this email and it goes to ${businessName}.`
          : `If the new time doesn't work, contact ${businessName} directly.`}
      </Note>
    </EmailLayout>
  );
}

BookingRescheduledEmail.PreviewProps = {
  origin: "https://sara.app",
  businessName: "Tolu's Hair Studio",
  serviceName: "Knotless braids",
  previousWhen: "Thu 1 Oct at 13:00",
  when: "Sat 3 Oct at 10:00",
  canReply: true,
} satisfies BookingRescheduledEmailProps;
