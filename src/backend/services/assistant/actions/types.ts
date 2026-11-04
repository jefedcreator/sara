import type { Prisma } from "@prisma/client";

import type { DraftRequest } from "./schemas";

export type OwnerEvidence = {
  text: string;
  recentOwnerTexts: string[];
  selectedIds: string[];
};

export type Clarification = {
  question: string;
  choices: { id: string; label: string }[];
  originalRequest: DraftRequest;
};

export type PreparedAction<
  K extends DraftRequest["kind"] = DraftRequest["kind"],
> = {
  kind: K;
  payload: Prisma.InputJsonObject;
  snapshot: Prisma.InputJsonObject;
};

export type ResolvedPayloadByKind = {
  create_invoice: {
    customer: {
      id?: string;
      name: string;
      phone: string | null;
      email: string | null;
      address: string | null;
    };
    lines: Array<{
      kind: "service" | "product" | "custom";
      id: string | null;
      name: string;
      description: string | null;
      quantity: number;
      unitPriceMinor: number;
      totalMinor: number;
      serviceId: string | null;
      productOptionId: string | null;
    }>;
    dueDate: string | null;
    notes: string | null;
    subtotalMinor: number;
    taxAmountMinor: number;
    discountMinor: number;
    totalMinor: number;
    currency: string;
  };
  create_receipt: {
    customer: {
      id?: string;
      name: string | null;
      phone: string | null;
      email: string | null;
    } | null;
    lines: Array<{
      kind: "service" | "product" | "custom";
      id: string | null;
      name: string;
      description: string | null;
      quantity: number;
      unitPriceMinor: number;
      totalMinor: number;
      serviceId: string | null;
      productOptionId: string | null;
    }>;
    amountPaidMinor: number;
    subtotalMinor: number;
    taxAmountMinor: number;
    discountMinor: number;
    totalMinor: number;
    method: "CASH" | "BANK_TRANSFER";
    fulfilment: "PICKUP" | "DELIVERY" | null;
    deliveryAddress: string | null;
    notes: string | null;
    currency: string;
  };
  record_invoice_payment: {
    invoiceId: string;
    amountMinor: number;
    method: "CASH" | "BANK_TRANSFER";
    createReceipt: boolean;
    currency: string;
  };
  void_invoice: {
    invoiceId: string;
    cancelOrder: boolean;
  };
  update_order: {
    orderId: string;
    status: "READY" | "COMPLETED" | "CANCELLED";
  };
  adjust_stock: {
    optionId: string;
    mode: "add" | "remove" | "set";
    quantity: number;
    previousStock: number;
    newStock: number;
  };
  update_booking: {
    bookingId: string;
    status: "CONFIRMED" | "CANCELLED" | "COMPLETED" | null;
    startTime: string | null;
    endTime: string | null;
    units: number;
  };
  create_product: {
    name: string;
    description: string | null;
    priceMinor: number;
    tracksStock: boolean;
    options: Array<{
      name: string;
      priceMinor: number | null;
      stock: number;
    }>;
  };
  update_product: {
    productId: string;
    name: string | null;
    description: string | null;
    priceMinor: number | null;
    isActive: boolean | null;
    tracksStock: boolean | null;
    options: Array<{
      optionId: string | null;
      name: string;
      priceMinor: number | null;
      stock: number;
    }> | null;
    fields: string[];
  };
  create_service: {
    name: string;
    description: string | null;
    priceMinor: number;
    duration: number;
    bookingMode: "SLOT" | "NIGHTLY" | "DAILY";
    availableFrom: string;
    availableTo: string;
    checkInTime: string | null;
    checkOutTime: string | null;
    minUnits: number;
    maxUnits: number;
  };
  update_service: {
    serviceId: string;
    name: string | null;
    description: string | null;
    priceMinor: number | null;
    isActive: boolean | null;
    duration: number | null;
    bookingMode: "SLOT" | "NIGHTLY" | "DAILY" | null;
    availableFrom: string | null;
    availableTo: string | null;
    checkInTime: string | null;
    checkOutTime: string | null;
    minUnits: number | null;
    maxUnits: number | null;
    fields: string[];
  };
  create_customer: {
    name: string;
    phone: string | null;
    email: string | null;
    address: string | null;
    notes: string | null;
  };
  update_customer: {
    customerId: string;
    name: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
    notes: string | null;
    fields: string[];
  };
};
