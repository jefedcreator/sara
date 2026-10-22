import type {
  Invoice,
  Service,
  Business,
  BusinessClosure,
  BusinessHours,
  Payment,
  Prisma,
  Product,
  ProductOption,
  Receipt,
  InvoiceLine,
  ReceiptLine,
  Booking,
  BookingMode,
  Order,
  OrderLine,
  OrderStatus,
  Customer,
} from "@prisma/client";

/**
 * A server value as it arrives over JSON: Decimals become strings (Prisma's
 * toJSON) and Dates become ISO strings. Client code types API data with this.
 */
export type Serialized<T> = T extends Prisma.Decimal
  ? string
  : T extends Date
    ? string
    : T extends (infer U)[]
      ? Serialized<U>[]
      : T extends object
        ? { [K in keyof T]: Serialized<T[K]> }
        : T;

export interface PaginationMeta {
  total: number;
  page: number;
  size: number;
  totalPages: number;
}

export interface ApiResponse<T = unknown> {
  status: number;
  message: string;
  data: T;
}

export interface ApiError {
  message: string;
}

export interface PaginatedApiResponse<T = unknown>
  extends ApiResponse<T>, PaginationMeta { }

/** The business as it rides along on invoices and receipts (no secrets). */
export type PublicBusiness = Pick<
  Business,
  | "id"
  | "ownerId"
  | "name"
  | "slug"
  | "email"
  | "phone"
  | "address"
  | "city"
  | "state"
  | "country"
  | "logoUrl"
  | "currency"
>;

export type InvoiceListItem = Invoice & {
  lines: (InvoiceLine & { service: Service | null })[];
  business: PublicBusiness;
  booking: {
    id: string;
    slug: string;
    clientName: string;
    startTime: Date;
  } | null;
  payments: Payment[];
  /** The order the invoice made on its first payment, when it lists products. */
  order: {
    id: string;
    slug: string;
    status: OrderStatus;
    orderNumber: string | null;
  } | null;
  _count: {
    payments: number;
  };
};

export type CreatedInvoice = Invoice & {
  business: Business;
  lines: (InvoiceLine & { service: Service | null })[];
};

export type ReceiptListItem = Receipt & {
  payment:
  | (Payment & {
    invoice?: {
      id: string;
      slug: string;
      invoiceNumber: string;
    } | null;
  })
  | null;
  business: PublicBusiness;
  lines: (ReceiptLine & { service: Service | null })[];
};

export type ServiceListItem = Service;

export interface TimeSlot {
  startTime: string; // ISO 8601
  endTime: string; // ISO 8601
  isAvailable: boolean;
}

export type ServiceDetail = Service & {
  slots: TimeSlot[];
  nights: NightDto[];
};

export type CreatedBooking = Booking & {
  paymentUrl: string;
  paymentReference: string;
}

export type IBooking = Booking & {
  business: Pick<Business, "ownerId">;
  service: Pick<Service, "id" | "name" | "price" | "duration" | "slug" | "image">;
};

// --- Client DTOs (JSON wire shapes) ---

export type ServiceDto = Serialized<Service>;

export type ProductOptionDto = Serialized<ProductOption>;

/** A product and its active options, ordered as the owner arranged them. */
export type ProductDto = Serialized<Product> & {
  options: ProductOptionDto[];
};

export type BusinessHoursDto = Serialized<BusinessHours>;

export type BusinessClosureDto = Serialized<BusinessClosure>;

export interface NightDto {
  date: string; // YYYY-MM-DD
  isAvailable: boolean;
}

/** GET /api/public/services/[slug] — what a customer may see. */
export interface PublicServiceDto {
  slug: string;
  name: string;
  description: string | null;
  image: string | null;
  price: string;
  duration: number;
  currency: string;
  businessName: string;
  bookingMode: BookingMode;
  checkInTime: string | null;
  checkOutTime: string | null;
  minUnits: number;
  maxUnits: number;
  /** SLOT: the day's slots. DAILY: pickup times. NIGHTLY: empty. */
  slots: TimeSlot[];
  /** NIGHTLY: the requested window's nights. Otherwise empty. */
  nights: NightDto[];
}

/** POST /api/public/bookings body. */
export interface PublicBookingInput {
  serviceSlug: string;
  startTime: string;
  /** Slot services only. */
  endTime?: string;
  /** Stays and rentals: nights or days. */
  units?: number;
  clientName: string;
  clientEmail?: string;
  clientPhone?: string;
  notes?: string;
}

export type PublicBookingDto = Serialized<Booking> & {
  paymentUrl: string;
  paymentReference: string;
};

/** POST /api/public/orders body. */
export interface PublicOrderInput {
  productSlug: string;
  optionId: string;
  quantity: number;
  fulfilment: "DELIVERY" | "PICKUP";
  deliveryAddress?: string | null;
  clientName: string;
  clientPhone: string;
  clientEmail?: string | null;
}

export type PublicOrderDto = Serialized<Order> & {
  paymentUrl: string;
  paymentReference: string;
};

/** What the business sells. */
export type Sells = "SERVICES" | "PRODUCTS" | "BOTH";

/**
 * The owner's business with everything secret stripped: bank numbers,
 * Paystack codes and Google tokens never reach the client. Flags say whether
 * each piece of setup is done.
 */
export interface BusinessProfileDto {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  currency: string;
  sells: Sells;
  offersDelivery: boolean;
  deliveryFee: number | null;
  offersPickup: boolean;
  settlementAccountName: string | null;
  isPaymentReady: boolean;
  calendarConnectedAt: string | null;
}


/** GET /api/dashboard — the owner's day. */
export interface DashboardData {
  currency: string;
  summary: {
    todayRevenue: number;
    weekRevenue: number;
    unpaidCount: number;
    unpaidTotal: number;
  };
  todayBookings: {
    slug: string;
    kind: "SLOT" | "CHECK_IN" | "CHECK_OUT" | "PICKUP" | "RETURN";
    at: string;
    units: number;
    startTime: string;
    endTime: string;
    status: "PENDING" | "CONFIRMED";
    clientName: string;
    serviceName: string;
  }[];
  unpaidInvoices: {
    slug: string;
    invoiceNumber: string;
    clientName: string;
    outstanding: number;
    currency: string;
    url: string | null;
  }[];
  revenueByService: {
    serviceId: string;
    serviceName: string;
    serviceSlug: string;
    totalRevenue: number;
    totalBookings: number;
  }[];
}

/** A page of a list endpoint, envelope removed. */
export interface Page<T> {
  data: T[];
  total: number;
  page: number;
  size: number;
  totalPages: number;
}

/** GET /api/bookings row. */
export type BookingDto = Serialized<Booking> & {
  service: { id: string; name: string; slug: string; price: string; duration: number; bookingMode: BookingMode };
};

export type InvoiceDto = Serialized<InvoiceListItem>;

export type ReceiptDto = Serialized<ReceiptListItem>;

/** GET /api/orders row and GET /api/orders/[slug]. */
export type OrderDto = Serialized<Order> & {
  lines: Serialized<OrderLine>[];
  customer: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
  } | null;
  invoice: {
    id: string;
    publicId: string;
    invoiceNumber: string;
  } | null;
  receipt: {
    id: string;
    publicId: string;
    receiptNumber: string;
  } | null;
};

/** GET /api/services/[slug]?date= — the owner's view of a day's slots. */
export type ServiceSlotsDto = Serialized<ServiceDetail>;

/** A saved customer, as the edit and merge endpoints return one. */
export type CustomerDto = Serialized<Customer>;

/** GET /api/customers row. */
export type CustomerListItem = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  spent: number;
  owes: number;
  lastActivityAt: string | null;
};

/** One row on a customer's page. */
export type TimelineEntry = {
  kind: "booking" | "invoice" | "receipt" | "order";
  id: string;
  label: string;
  amount: number;
  status: string;
  at: string;
  href: string | null;
};

/** GET /api/customers/[id]. */
export type CustomerDetail = CustomerListItem & {
  address: string | null;
  notes: string | null;
  createdAt: string;
  timeline: TimelineEntry[];
};
