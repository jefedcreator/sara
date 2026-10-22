import { type Metadata } from "next";

import { AppError } from "@/components/app-error";
import { CustomerDetailClient } from "@/components/customers/customer-detail-client";
import { getCustomerDetail, requireBusiness } from "@/server";
import { cardMetadata } from "@/utils/metadata";

export const metadata: Metadata = cardMetadata("customers", {
  path: "/customers",
  index: false,
});

export default async function CustomerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { business } = await requireBusiness(`/customers/${id}`);

  let customer;
  try {
    customer = await getCustomerDetail(business.id, id);
  } catch (error) {
    console.error("[customers] failed to load one:", error);
    return <AppError title="This customer didn't load." />;
  }

  return <CustomerDetailClient initial={customer} currency={business.currency} />;
}
