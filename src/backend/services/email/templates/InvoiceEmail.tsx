import {
  CtaButton,
  Details,
  EmailLayout,
  FallbackLink,
  Heading,
  Note,
  Paragraph,
  greeting,
} from "./_components/Layout";

export interface InvoiceEmailProps {
  origin: string;
  businessName: string;
  customerName: string | null;
  number: string;
  /** Money as the app writes it: "NGN 62,000". */
  total: string;
  /** What's still owed, when some has been paid; else null. */
  balance: string | null;
  /** "12 Oct 2026", or null. */
  dueDate: string | null;
  /** The invoice's share page. */
  url: string;
  canReply: boolean;
}

/** To the customer, when the business sends them an invoice. */
export default function InvoiceEmail(props: InvoiceEmailProps) {
  const {
    origin,
    businessName,
    customerName,
    number,
    total,
    balance,
    dueDate,
    url,
    canReply,
  } = props;
  const owed = balance ?? total;
  return (
    <EmailLayout
      origin={origin}
      sender={{ kind: "business", name: businessName, credit: "Invoices" }}
      preview={`${owed} to pay${dueDate ? ` by ${dueDate}` : ""}.`}
    >
      <Heading>Invoice {number}</Heading>
      <Paragraph>{greeting(customerName)}</Paragraph>
      <Paragraph>
        {balance
          ? `${businessName} sent you an invoice for ${total}. ${balance} is left to pay`
          : `${businessName} sent you an invoice for ${total}`}
        {dueDate ? `, due ${dueDate}` : ""}. The details and a PDF copy are on
        the invoice page.
      </Paragraph>
      <Details
        rows={[
          { label: "Total", value: total, strong: balance === null },
          ...(balance
            ? [{ label: "Still to pay", value: balance, strong: true }]
            : []),
          ...(dueDate ? [{ label: "Due", value: dueDate }] : []),
        ]}
      />
      <CtaButton href={url}>View invoice</CtaButton>
      <Note>
        {canReply
          ? `Questions about it? Reply to this email and it goes to ${businessName}.`
          : `Questions about it? Contact ${businessName} directly.`}
      </Note>
      <FallbackLink href={url} />
    </EmailLayout>
  );
}

InvoiceEmail.PreviewProps = {
  origin: "https://sara.app",
  businessName: "Tolu's Hair Studio",
  customerName: "Ada Okafor",
  number: "INV-1012",
  total: "NGN 62,000",
  balance: "NGN 42,000",
  dueDate: "12 Oct 2026",
  url: "https://sara.app/invoices/Xk39fjQ2aB7mN0pR",
  canReply: true,
} satisfies InvoiceEmailProps;
