import type {
  Invoice,
  Service,
  Business,
  BusinessClosure,
  BusinessHours,
  Payment,
  Prisma,
  Receipt,
  InvoiceService,
  ReceiptService,
  Booking,
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
  services: (InvoiceService & { service: Service })[];
  business: PublicBusiness;
  booking: {
    id: string;
    slug: string;
    clientName: string;
    startTime: Date;
  } | null;
  payments: Payment[];
  _count: {
    payments: number;
  };
};

export type CreatedInvoice = Invoice & {
  business: Business;
  services: (InvoiceService & { service: Service })[];
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
  services: (ReceiptService & { service: Service })[];
};

export type ServiceListItem = Service;

export interface TimeSlot {
  startTime: string; // ISO 8601
  endTime: string; // ISO 8601
  isAvailable: boolean;
}

export type ServiceDetail = Service & {
  slots: TimeSlot[];
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

export type BusinessHoursDto = Serialized<BusinessHours>;

export type BusinessClosureDto = Serialized<BusinessClosure>;

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
  slots: TimeSlot[];
}

/** POST /api/public/bookings body. */
export interface PublicBookingInput {
  serviceSlug: string;
  startTime: string;
  endTime: string;
  clientName: string;
  clientEmail?: string;
  clientPhone?: string;
  notes?: string;
}

export type PublicBookingDto = Serialized<Booking> & {
  paymentUrl: string;
  paymentReference: string;
};

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
