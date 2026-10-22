import { Column, Hr, Link, Row, Section } from "@react-email/components";

import {
  CtaButton,
  Details,
  EmailLayout,
  Heading,
  Note,
  Paragraph,
  Pill,
} from "./_components/Layout";

export type OrderEmailKind = "confirmed" | "ready" | "completed" | "cancelled";
export type OrderFulfilment = "DELIVERY" | "PICKUP";

export interface OrderEmailLine {
  /** The option's label, e.g. `Frontal wig — 20"`. */
  name: string;
  quantity: number;
  /** "NGN 62,000". */
  total: string;
}

export interface OrderEmailProps {
  origin: string;
  businessName: string;
  kind: OrderEmailKind;
  orderNumber: string;
  lines: OrderEmailLine[];
  /** "NGN 93,000". */
  total: string;
  fulfilment: OrderFulfilment;
  /** Where a delivery goes, when that's how it's coming. */
  deliveryAddress: string | null;
  /** Where to collect it, when that's how it's coming. */
  pickupAddress: string | null;
  /** The receipt's share page, when one was issued. */
  receiptUrl: string | null;
  /** The customer's order page. */
  orderUrl: string;
  /** Whether a reply reaches the business (it has an email on file). */
  canReply: boolean;
}

function pillFor(kind: OrderEmailKind, fulfilment: OrderFulfilment) {
  if (kind === "ready") {
    return fulfilment === "PICKUP" ? "Ready" : "On its way";
  }
  if (kind === "completed") {
    return fulfilment === "DELIVERY" ? "Delivered" : "Collected";
  }
  return kind === "confirmed" ? "Confirmed" : "Cancelled";
}

function headingFor(kind: OrderEmailKind, fulfilment: OrderFulfilment) {
  switch (kind) {
    case "confirmed":
      return "Your order is confirmed.";
    case "ready":
      return fulfilment === "PICKUP"
        ? "Your order is ready."
        : "Your order is on its way.";
    case "completed":
      return fulfilment === "DELIVERY"
        ? "Your order was delivered."
        : "Thanks for collecting your order.";
    case "cancelled":
      return "Your order was cancelled.";
  }
}

function leadFor(
  kind: OrderEmailKind,
  fulfilment: OrderFulfilment,
  businessName: string,
) {
  switch (kind) {
    case "confirmed":
      return fulfilment === "PICKUP"
        ? `Thanks for your order from ${businessName}. We'll email you as soon as it's ready to collect.`
        : `Thanks for your order from ${businessName}. We'll email you as soon as it's on its way.`;
    case "ready":
      return fulfilment === "PICKUP"
        ? `It's waiting for you at ${businessName}. Show your order number when you collect it.`
        : `It's left ${businessName} and is on its way to you. Keep your phone nearby.`;
    case "completed":
      return fulfilment === "DELIVERY"
        ? `We hope you love it. Here's what you ordered from ${businessName}.`
        : `We hope you love it. Here's what you collected from ${businessName}.`;
    case "cancelled":
      return "This order won't go ahead. Its details stay on the order page if you need them.";
  }
}

function noteFor(
  kind: OrderEmailKind,
  fulfilment: OrderFulfilment,
  businessName: string,
  canReply: boolean,
) {
  if (kind === "cancelled") {
    return canReply
      ? `Questions about this order? Reply to this email and it goes to ${businessName}.`
      : `Questions about this order? Contact ${businessName} directly.`;
  }
  if (kind === "completed") {
    return "Keep this email; the order page keeps working.";
  }
  if (kind === "ready" && fulfilment === "PICKUP") {
    return canReply
      ? `Can't make it today? Reply to this email and it goes to ${businessName}.`
      : `Can't make it today? Let ${businessName} know.`;
  }
  return canReply
    ? `Need to change something? Reply to this email and it goes to ${businessName}.`
    : `Need to change something? Contact ${businessName} directly.`;
}

/** To the customer, as their order moves from confirmed to collected or delivered. */
export default function OrderEmail(props: OrderEmailProps) {
  const {
    origin,
    businessName,
    kind,
    orderNumber,
    lines,
    total,
    fulfilment,
    deliveryAddress,
    pickupAddress,
    receiptUrl,
    orderUrl,
    canReply,
  } = props;
  const address = fulfilment === "PICKUP" ? pickupAddress : deliveryAddress;
  const where = kind === "confirmed" || kind === "ready" ? address : null;
  const heading = headingFor(kind, fulfilment);
  return (
    <EmailLayout
      origin={origin}
      sender={{ kind: "business", name: businessName, credit: "Orders" }}
      preview={`Order ${orderNumber} from ${businessName}.`}
    >
      <Pill tone={kind === "cancelled" ? "muted" : "accent"}>
        {pillFor(kind, fulfilment)}
      </Pill>
      <Heading>{heading}</Heading>
      <Paragraph>{leadFor(kind, fulfilment, businessName)}</Paragraph>
      <Details
        rows={[
          { label: "Order", value: orderNumber, strong: true },
          ...(where
            ? [
                {
                  label:
                    fulfilment === "PICKUP" ? "Pick up from" : "Deliver to",
                  value: where,
                },
              ]
            : []),
        ]}
      />
      <Section className="bg-surface mt-4 rounded-[20px] px-5 py-3">
        {lines.map((line, index) => (
          <Row key={`${line.name}-${index}`}>
            <Column className="text-ink py-[7px] pr-4 text-[14px] leading-[1.45]">
              {`${line.quantity} × ${line.name}`}
            </Column>
            <Column
              align="right"
              className="text-ink py-[7px] text-[14px] leading-[1.45] whitespace-nowrap"
            >
              {line.total}
            </Column>
          </Row>
        ))}
        <Hr className="border-line my-1" />
        <Row>
          <Column className="text-muted py-[7px] pr-4 text-[14px] leading-[1.45] font-semibold">
            Total
          </Column>
          <Column
            align="right"
            className="text-ink py-[7px] text-[14px] leading-[1.45] font-semibold whitespace-nowrap"
          >
            {total}
          </Column>
        </Row>
      </Section>
      <CtaButton href={orderUrl}>View your order</CtaButton>
      {receiptUrl ? (
        <Paragraph>
          <Link href={receiptUrl} className="text-ink-2 underline">
            View your receipt
          </Link>
        </Paragraph>
      ) : null}
      <Note>{noteFor(kind, fulfilment, businessName, canReply)}</Note>
    </EmailLayout>
  );
}

OrderEmail.PreviewProps = {
  origin: "https://sara.app",
  businessName: "Tobi Hair",
  kind: "ready",
  orderNumber: "ORD-1022",
  lines: [
    { name: 'Frontal wig — 20"', quantity: 2, total: "NGN 62,000" },
    { name: "Closure — 5x5", quantity: 1, total: "NGN 31,000" },
  ],
  total: "NGN 93,000",
  fulfilment: "PICKUP",
  deliveryAddress: "4 Ozumba Mbadiwe Avenue, Victoria Island, Lagos",
  pickupAddress: "12 Admiralty Way, Lekki, Lagos",
  receiptUrl: "https://sara.app/receipts/b7T0qLm2Vn9cZ4wE",
  orderUrl: "https://sara.app/orders/Xk39fjQ2aB7mN0pR",
  canReply: true,
} satisfies OrderEmailProps;
