import {
  CtaButton,
  Details,
  EmailLayout,
  Heading,
  Note,
  Paragraph,
  Pill,
} from "./_components/Layout";

export interface NewBookingEmailProps {
  origin: string;
  clientName: string;
  clientEmail: string | null;
  clientPhone: string | null;
  serviceName: string;
  /** "Thu 1 Oct at 13:00". */
  when: string;
  /** "NGN 25,000". */
  paid: string;
}

/** To the owner, when a customer pays for a booking through their link. */
export default function NewBookingEmail(props: NewBookingEmailProps) {
  const {
    origin,
    clientName,
    clientEmail,
    clientPhone,
    serviceName,
    when,
    paid,
  } = props;
  return (
    <EmailLayout
      origin={origin}
      sender={{ kind: "sara" }}
      preview={`${clientName} booked ${serviceName} for ${when} and paid ${paid}.`}
    >
      <Pill>Paid</Pill>
      <Heading>
        {clientName} booked {serviceName}.
      </Heading>
      <Paragraph>
        The payment went through, the slot is yours to keep free, and
        they&apos;ll get a reminder the day before.
      </Paragraph>
      <Details
        rows={[
          { label: "When", value: when, strong: true },
          { label: "Service", value: serviceName },
          { label: "Paid", value: paid },
          ...(clientPhone ? [{ label: "Phone", value: clientPhone }] : []),
          ...(clientEmail ? [{ label: "Email", value: clientEmail }] : []),
        ]}
      />
      <CtaButton href={`${origin}/bookings`}>See your bookings</CtaButton>
      <Note>
        The receipt is already in your receipts, and your chat has the same
        news.
      </Note>
    </EmailLayout>
  );
}

NewBookingEmail.PreviewProps = {
  origin: "https://sara.app",
  clientName: "Ada Okafor",
  clientEmail: "ada@example.com",
  clientPhone: "+234 803 000 0000",
  serviceName: "Knotless braids",
  when: "Thu 1 Oct at 13:00",
  paid: "NGN 25,000",
} satisfies NewBookingEmailProps;
