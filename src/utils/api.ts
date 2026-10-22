import type {
  ApiResponse,
  BookingDto,
  BusinessClosureDto,
  CustomerDetail,
  CustomerDto,
  CustomerListItem,
  DashboardData,
  InvoiceDto,
  OrderDto,
  Page,
  ProductDto,
  ProductOptionDto,
  ReceiptDto,
  ServiceSlotsDto,
  BusinessHoursDto,
  PaginatedApiResponse,
  PublicBookingDto,
  PublicBookingInput,
  PublicOrderDto,
  PublicOrderInput,
  PublicServiceDto,
  Sells,
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

export type ProductOptionInput = {
  id?: string;
  name: string;
  price: number | null;
  stock: number;
};

export type ProductInput = {
  name: string;
  description?: string;
  price: number;
  tracksStock: boolean;
  options: ProductOptionInput[];
};

export type StockAdjustInput = {
  optionId: string;
  add?: number;
  set?: number;
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
  sells?: Sells;
  offersDelivery?: boolean;
  deliveryFee?: number | null;
  offersPickup?: boolean;
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

/** OPEN is the to-send-out queue: new and ready orders together. */
export type OrderStatusFilter = "OPEN" | "NEW" | "READY" | "COMPLETED" | "CANCELLED";

export type OrderListParams = {
  status?: OrderStatusFilter;
  page?: number;
};

/** One change per call: a status step, or a switch between delivery and pickup. */
export type OrderUpdateInput =
  | { status: "READY" | "COMPLETED" | "CANCELLED" }
  | { fulfilment: "DELIVERY" | "PICKUP"; deliveryAddress?: string | null };

export type CustomerListParams = {
  query?: string;
  page?: number;
};

export type CustomerUpdateInput = {
  name?: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
};

export type CustomerMergeInput = {
  keepId: string;
  mergeId: string;
};

export type DocumentLineInput = {
  serviceId?: string | null;
  productOptionId?: string | null;
  name?: string;
  description?: string | null;
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
  lines?: DocumentLineInput[];
};

export type InvoiceCreateInput = DocumentMoney & {
  status: "DRAFT" | "SENT";
  amountPaid: number;
  sentAt?: string;
  dueAt?: string;
  customerId?: string;
};

export type InvoicePaymentInput = {
  status: "PAID" | "PARTIALLY_PAID";
  amountPaid: number;
  paidAt?: string;
};

export type InvoiceUpdateInput = Partial<DocumentMoney> & {
  name?: string;
  email?: string;
  phone?: string;
  status?: "DRAFT" | "SENT";
  amountPaid?: number;
  dueAt?: string;
  sentAt?: string;
  notes?: string;
  lines?: DocumentLineInput[];
  customerId?: string;
};

/** How a receipt's products reach the customer; sent only when it has a product line. */
export type ReceiptSaleInput = {
  fulfilment: "DELIVERY" | "PICKUP";
  deliveryAddress?: string | null;
};

export type ReceiptCreateInput = DocumentMoney & {
  amountPaid: number;
  paymentMethod?: "CASH" | "BANK_TRANSFER" | "PAYSTACK";
  customerId?: string;
  sale?: ReceiptSaleInput;
};

export type ReceiptUpdateInput = Partial<DocumentMoney> & {
  name?: string;
  email?: string;
  phone?: string;
  amountPaid?: number;
  paymentMethod?: "CASH" | "BANK_TRANSFER";
  notes?: string;
  lines?: DocumentLineInput[];
  customerId?: string;
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

function toFormData(
  values: Record<string, string | number | boolean | File | null | undefined>,
) {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === "") continue;
    form.set(key, value instanceof File ? value : String(value));
  }
  return form;
}

/** Product fields for multipart, with each new file appended as `photos`. */
function productFormData(
  values: Partial<ProductInput> & { isActive?: boolean },
  photos: File[],
  keepPhotos?: string[],
) {
  const form = new FormData();

  if (values.name !== undefined) form.set("name", values.name);
  // An empty description is meaningful on edit: it clears the old one.
  if (values.description !== undefined) form.set("description", values.description);
  if (values.price !== undefined) form.set("price", String(values.price));
  if (values.tracksStock !== undefined) {
    form.set("tracksStock", String(values.tracksStock));
  }
  if (values.options !== undefined) {
    form.set("options", JSON.stringify(values.options));
  }
  if (values.isActive !== undefined) form.set("isActive", String(values.isActive));
  if (keepPhotos !== undefined) form.set("keepPhotos", JSON.stringify(keepPhotos));

  for (const photo of photos) form.append("photos", photo);

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
    order: (input: PublicOrderInput) =>
      data<PublicOrderDto>(http.post("/public/orders", input)),
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

  products: {
    // The owner's list includes paused products so they can be resumed.
    list: () =>
      data<ProductDto[]>(
        http.get("/products", { params: { includeInactive: true } }),
      ),
    create: (values: ProductInput, photos: File[] = []) =>
      data<ProductDto>(http.post("/products", productFormData(values, photos))),
    update: (
      slug: string,
      values: Partial<ProductInput> & { isActive?: boolean },
      photos: File[] = [],
      keepPhotos?: string[],
    ) =>
      data<ProductDto>(
        http.put(
          `/products/${encodeURIComponent(slug)}`,
          productFormData(values, photos, keepPhotos),
        ),
      ),
    adjustStock: (slug: string, input: StockAdjustInput) =>
      data<ProductOptionDto>(
        http.post(`/products/${encodeURIComponent(slug)}/stock`, input),
      ),
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
    reschedule: (slug: string, startTime: string, endTime?: string) =>
      data<BookingDto>(
        http.put(`/bookings/${encodeURIComponent(slug)}`, endTime ? { startTime, endTime } : { startTime }),
      ),
    nights: (serviceSlug: string, from: string, to: string, exclude: string) =>
      data<ServiceSlotsDto>(http.get(`/services/${encodeURIComponent(serviceSlug)}`, { params: { from, to, exclude } })),
    pickups: (serviceSlug: string, date: string, units: number, exclude: string) =>
      data<ServiceSlotsDto>(http.get(`/services/${encodeURIComponent(serviceSlug)}`, { params: { date, units, exclude } })),
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
    update: (slug: string, values: InvoiceUpdateInput) =>
      data<InvoiceDto>(http.put(`/invoices/${encodeURIComponent(slug)}`, values)),
    recordPayment: (slug: string, values: InvoicePaymentInput) =>
      data<InvoiceDto>(http.put(`/invoices/${encodeURIComponent(slug)}`, values)),
    setStatus: (
      slug: string,
      status: "SENT" | "VOID",
      opts?: { cancelOrder?: boolean },
    ) =>
      data<InvoiceDto>(
        http.put(`/invoices/${encodeURIComponent(slug)}`, {
          status,
          ...(status === "SENT" ? { sentAt: new Date().toISOString() } : {}),
          ...(status === "VOID" && opts?.cancelOrder ? { cancelOrder: true } : {}),
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
    update: (slug: string, values: ReceiptUpdateInput) =>
      data<ReceiptDto>(http.put(`/receipts/${encodeURIComponent(slug)}`, values)),
  },

  orders: {
    list: ({ status, page: pageNumber = 1 }: OrderListParams) =>
      page<OrderDto>(
        http.get("/orders", { params: { status, page: pageNumber, size: PAGE_SIZE } }),
      ),
    get: (slug: string) =>
      data<OrderDto>(http.get(`/orders/${encodeURIComponent(slug)}`)),
    update: (slug: string, values: OrderUpdateInput) =>
      data<OrderDto>(http.put(`/orders/${encodeURIComponent(slug)}`, values)),
  },

  customers: {
    list: ({ query, page: pageNumber = 1 }: CustomerListParams) =>
      page<CustomerListItem>(
        http.get("/customers", {
          params: {
            query: query?.trim() || undefined,
            page: pageNumber,
            size: PAGE_SIZE,
          },
        }),
      ),
    get: (id: string) =>
      data<CustomerDetail>(http.get(`/customers/${encodeURIComponent(id)}`)),
    update: (id: string, values: CustomerUpdateInput) =>
      data<CustomerDto>(http.put(`/customers/${encodeURIComponent(id)}`, values)),
    merge: ({ keepId, mergeId }: CustomerMergeInput) =>
      data<CustomerDto>(http.post("/customers/merge", { keepId, mergeId })),
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
