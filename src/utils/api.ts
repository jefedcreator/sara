import type {
  ApiResponse,
  BusinessClosureDto,
  BusinessHoursDto,
  PaginatedApiResponse,
  PublicBookingDto,
  PublicBookingInput,
  PublicServiceDto,
  ServiceDto,
} from "types";

import http from "./axios";

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
};

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
    remove: (slug: string) =>
      data<ServiceDto>(http.delete(`/services/${encodeURIComponent(slug)}`)),
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
