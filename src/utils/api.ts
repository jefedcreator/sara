import type {
  ApiResponse,
  BookingDto,
  BusinessClosureDto,
  DashboardData,
  InvoiceDto,
  Page,
  ReceiptDto,
  ServiceSlotsDto,
  BusinessHoursDto,
  PaginatedApiResponse,
  PublicBookingDto,
  PublicBookingInput,
  PublicServiceDto,
  ServiceDto,
} from "types";

import http from "./axios";

/** A just-created invoice or receipt's customer link (/i/… or /r/…). */
type SharedLink = { shareUrl: string };

/*
 * Typed methods over the REST API. Every method resolves to the response's
 * `data` so hooks never unwrap envelopes themselves.
 */

async function data<T>(request: Promise<{ data: ApiResponse<T> }>) {
  const response = await request;
  return response.data.data;
}

export type ServiceFormInput = {
  name: string;
  description?: string;
  price: number;
  duration: number;
  availableFrom: string;
  availableTo: string;
};

export type BusinessHoursInput = {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  isClosed: boolean;
};

export type BusinessUpdateInput = {
  name?: string;
  description?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
};

export type BusinessCreateInput = BusinessUpdateInput & {
  name: string;
  monoCode: string;
  currency?: string;
  country?: string;
};

export type BookingStatus = "PENDING" | "CONFIRMED" | "COMPLETED" | "CANCELLED";

export type BookingListParams = {
  status?: BookingStatus;
  page?: number;
  sortOrder?: "asc" | "desc";
};

export type InvoiceListParams = {
  status?: "DRAFT" | "PAID" | "VOID";
  unpaid?: boolean;
  page?: number;
};

export type LineItemInput = {
  serviceId: string;
  description?: string;
  quantity: number;
  unitPrice: number;
  total: number;
};

/** Money fields shared by invoices and receipts. */
type DocumentMoney = {
  name: string;
  email?: string;
  phone?: string;
  currency: string;
  subtotal: number;
  taxAmount: number;
  discount: number;
  total: number;
  notes?: string;
  services?: LineItemInput[];
};

export type InvoiceCreateInput = DocumentMoney & {
  status: "DRAFT" | "SENT";
  amountPaid: number;
  sentAt?: string;
  dueAt?: string;
};

export type InvoicePaymentInput = {
  status: "PAID" | "PARTIALLY_PAID";
  amountPaid: number;
  paidAt?: string;
};

export type ReceiptCreateInput = DocumentMoney & {
  amountPaid: number;
  paymentMethod?: "CASH" | "BANK_TRANSFER" | "PAYSTACK";
};

// Matches PAGE_SIZE in src/server/lists.ts, so server-seeded pages line up.
const PAGE_SIZE = 20;

async function page<T>(request: Promise<{ data: ApiResponse<T[]> & Omit<Page<T>, "data"> }>) {
  const { data } = await request;
  return {
    data: data.data,
    total: data.total,
    page: data.page,
    size: data.size,
    totalPages: data.totalPages,
  } satisfies Page<T>;
}

function toFormData(values: Record<string, string | number | File | undefined>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === "") continue;
    form.set(key, value instanceof File ? value : String(value));
  }
  return form;
}

export const api = {
  public: {
    service: (slug: string, date: string) =>
      data<PublicServiceDto>(
        http.get(`/public/services/${encodeURIComponent(slug)}`, {
          params: { date },
        }),
      ),
    nights: (slug: string, from: string, to: string) =>
      data<PublicServiceDto>(http.get(`/public/services/${encodeURIComponent(slug)}`, { params: { from, to } })),
    pickups: (slug: string, date: string, units: number) =>
      data<PublicServiceDto>(http.get(`/public/services/${encodeURIComponent(slug)}`, { params: { date, units } })),
    book: (input: PublicBookingInput) =>
      data<PublicBookingDto>(http.post("/public/bookings", input)),
  },

  services: {
    list: async () => {
      const response = await http.get<PaginatedApiResponse<ServiceDto[]>>(
        "/services",
        { params: { all: true, sortBy: "createdAt", sortOrder: "desc" } },
      );
      return response.data.data;
    },
    // Multipart so an image can ride along. isActive is left to its default
    // (true): multipart sends strings and the schema wants a boolean.
    create: (values: ServiceFormInput, image?: File) =>
      data<ServiceDto>(
        http.post("/services", toFormData({ ...values, image })),
      ),
    update: async (
      slug: string,
      values: Partial<ServiceFormInput> & { isActive?: boolean },
      image?: File,
    ) => {
      // A rename changes the slug, so the image goes to the slug we get back.
      let service = await data<ServiceDto>(http.put(`/services/${slug}`, values));
      if (image) {
        service = await data<ServiceDto>(
          http.put(`/services/${service.slug}`, toFormData({ image })),
        );
      }
      return service;
    },
    // Services with bookings or invoices are paused rather than deleted; only
    // the response message says which happened.
    remove: async (slug: string) => {
      const response = await http.delete<ApiResponse<ServiceDto>>(
        `/services/${encodeURIComponent(slug)}`,
      );
      return {
        service: response.data.data,
        paused: response.data.message.toLowerCase().includes("deactivated"),
      };
    },
  },

  business: {
    create: (values: BusinessCreateInput) =>
      data<unknown>(http.post("/business", toFormData(values))),
    update: (values: BusinessUpdateInput) =>
      data<unknown>(http.put("/business", values)),
    hours: () => data<BusinessHoursDto[]>(http.get("/business/hours")),
    saveHours: (days: BusinessHoursInput[]) =>
      data<BusinessHoursDto[]>(http.put("/business/hours", { days })),
    closures: () => data<BusinessClosureDto[]>(http.get("/business/closures")),
    addClosure: (values: { date: string; reason?: string }) =>
      data<BusinessClosureDto>(http.post("/business/closures", values)),
    removeClosure: (id: string) =>
      data<unknown>(http.delete(`/business/closures/${id}`)),
    calendarConnectUrl: () =>
      data<{ authorizationUrl: string }>(
        http.get("/business/google-calendar/connect"),
      ),
    disconnectCalendar: () =>
      data<unknown>(http.delete("/business/google-calendar")),
  },

  dashboard: () => data<DashboardData>(http.get("/dashboard")),

  bookings: {
    list: ({ status, page: pageNumber = 1, sortOrder = "desc" }: BookingListParams) =>
      page<BookingDto>(
        http.get("/bookings", {
          params: { status, page: pageNumber, size: PAGE_SIZE, sortBy: "startTime", sortOrder },
        }),
      ),
    setStatus: (slug: string, status: BookingStatus) =>
      data<BookingDto>(http.put(`/bookings/${encodeURIComponent(slug)}`, { status })),
    reschedule: (slug: string, startTime: string, endTime: string) =>
      data<BookingDto>(
        http.put(`/bookings/${encodeURIComponent(slug)}`, { startTime, endTime }),
      ),
    /** A service's slots for a day, as the owner sees them. */
    slots: (serviceSlug: string, date: string) =>
      data<ServiceSlotsDto>(
        http.get(`/services/${encodeURIComponent(serviceSlug)}`, { params: { date } }),
      ),
  },

  invoices: {
    list: ({ status, unpaid, page: pageNumber = 1 }: InvoiceListParams) =>
      page<InvoiceDto>(
        http.get("/invoices", {
          params: {
            status,
            unpaid: unpaid ? true : undefined,
            page: pageNumber,
            size: PAGE_SIZE,
            sortBy: "createdAt",
            sortOrder: "desc",
          },
        }),
      ),
    create: (values: InvoiceCreateInput) =>
      data<InvoiceDto & SharedLink>(http.post("/invoices", values)),
    recordPayment: (slug: string, values: InvoicePaymentInput) =>
      data<InvoiceDto>(http.put(`/invoices/${encodeURIComponent(slug)}`, values)),
    setStatus: (slug: string, status: "SENT" | "VOID") =>
      data<InvoiceDto>(
        http.put(`/invoices/${encodeURIComponent(slug)}`, {
          status,
          ...(status === "SENT" ? { sentAt: new Date().toISOString() } : {}),
        }),
      ),
    remove: (slug: string) =>
      data<unknown>(http.delete(`/invoices/${encodeURIComponent(slug)}`)),
  },

  receipts: {
    list: ({ page: pageNumber = 1 }: { page?: number }) =>
      page<ReceiptDto>(
        http.get("/receipts", {
          params: { page: pageNumber, size: PAGE_SIZE, sortBy: "createdAt", sortOrder: "desc" },
        }),
      ),
    create: (values: ReceiptCreateInput) =>
      data<ReceiptDto & SharedLink>(http.post("/receipts", values)),
  },

  messaging: {
    link: async (token: string) => {
      const response = await http.post<{ message: string }>(
        "/messaging/link",
        { token },
      );
      return response.data;
    },
  },
};
