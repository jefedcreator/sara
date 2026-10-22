import { type Metadata } from "next";
import { notFound } from "next/navigation";

import { PublicError } from "@/components/public-error";
import { OrderPage } from "@/components/public/order-page";
import { getPublicOrder } from "@/server";
import { orderMetadata } from "@/utils/order-page";
import { publicPath } from "@/utils/public-links";

type Params = { params: Promise<{ publicId: string }> };

// Payment and fulfilment land after the link is sent.
export const dynamic = "force-dynamic";

/** The order link in the customer's payment return and receipt emails. */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { publicId } = await params;
  const order = await getPublicOrder(publicId).catch(() => null);
  return orderMetadata(order, publicPath("order", publicId));
}

export default async function PublicOrderPage({ params }: Params) {
  const { publicId } = await params;

  let order;
  try {
    order = await getPublicOrder(publicId);
  } catch (error) {
    console.error("[orders] failed to load order:", error);
    return (
      <PublicError
        title="This order didn't load."
        body="Something went wrong on our side. Refresh the page to try again."
      />
    );
  }

  if (!order) notFound();

  return <OrderPage order={order} />;
}
