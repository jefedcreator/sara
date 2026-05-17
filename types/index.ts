import type {
  Invoice,
  Service,
  Business,
  Payment,
  Receipt,
  InvoiceService,
  ReceiptService,
} from "@prisma/client";

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
  extends ApiResponse<T>, PaginationMeta {}

export type InvoiceListItem = Invoice & {
  services: (InvoiceService & { service: Service })[];
  business: Business;
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
  business: Business;
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
