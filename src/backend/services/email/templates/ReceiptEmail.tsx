import {
  CtaButton,
  Details,
  EmailLayout,
  Heading,
  Note,
  Paragraph,
  Pill,
  greeting,
} from "./_components/Layout";

export interface ReceiptEmailProps {
  origin: string;
  businessName: string;
  customerName: string | null;
  number: string;
  /** "NGN 15,000". */
  paid: string;
  /** "29 Sept 2026". */
  date: string;
  /** "Bank transfer", or null. */
  method: string | null;
  /** The receipt's share page. */
  url: string;
}

/** To the customer, when the business issues a receipt for their payment. */
export default function ReceiptEmail(props: ReceiptEmailProps) {
  const {
    origin,
    businessName,
    customerName,
    number,
    paid,
    date,
    method,
    url,
  } = props;
  return (
    <EmailLayout
      origin={origin}
      sender={{ kind: "business", name: businessName, credit: "Receipts" }}
      preview={`${paid} paid to ${businessName} on ${date}.`}
    >
      <Pill>Paid</Pill>
      <Heading>Receipt {number}</Heading>
      <Paragraph>{greeting(customerName)}</Paragraph>
      <Paragraph>
        Thanks for your payment to {businessName}. This is your proof of it; the
        receipt page has a PDF copy to keep.
      </Paragraph>
      <Details
        rows={[
          { label: "Amount paid", value: paid, strong: true },
          { label: "Date", value: date },
          ...(method ? [{ label: "Paid by", value: method }] : []),
        ]}
      />
      <CtaButton href={url}>View receipt</CtaButton>
      <Note>Keep this email; the link keeps working.</Note>
    </EmailLayout>
  );
}

ReceiptEmail.PreviewProps = {
  origin: "https://sara.app",
  businessName: "Tolu's Hair Studio",
  customerName: "Ada Okafor",
  number: "RCP-1007",
  paid: "NGN 15,000",
  date: "29 Sept 2026",
  method: "Bank transfer",
  url: "https://sara.app/r/tolus-hair-studio-rcp-1007/preview",
} satisfies ReceiptEmailProps;
