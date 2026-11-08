import type { User, Session, Business } from "@prisma/client";
import { type NextRequest } from "next/server";
import type z from "zod";
import type { BaseQueryValidatorSchema } from "../validators/index.validator";
import type { InvoiceQueryValidatorSchema } from "../validators/invoice.validator";
import type { ReceiptQueryValidatorSchema } from "../validators/receipt.validator";
import type { ServiceDetailQueryValidatorSchema } from "../validators/service.validator";
import type {
  AtlasGeocodeQueryValidatorSchema,
  AtlasReverseQueryValidatorSchema,
  AtlasSearchQueryValidatorSchema,
} from "../validators/atlas.validator";
import type { AssistantListQueryValidatorSchema } from "../validators/assistant.validator";

export type MiddlewareResponse = {
  message: string;
  statusCode: number;
  next: boolean;
  redirect?: string;
};

export type MiddlewareFunction<B = unknown, Q = QueryParameters> = (
  req: AuthRequest<B, Q>,
) => Promise<MiddlewareResponse>;

type Prettify<T> = {
  [K in keyof T]: T[K];
} & {};

/**
 * The union of every query schema in the app, so `withMiddleware`'s default
 * `Q` can name any route's parsed query. A route that needs a precise type
 * passes its own: `withMiddleware<unknown, ServiceQueryValidatorSchema>(…)`.
 */
export type QueryParameters = Prettify<
  Partial<BaseQueryValidatorSchema> &
    Partial<InvoiceQueryValidatorSchema> &
    Partial<ReceiptQueryValidatorSchema> &
    Partial<ServiceDetailQueryValidatorSchema> &
    Partial<AssistantListQueryValidatorSchema> &
    AtlasSearchQueryValidatorSchema &
    AtlasGeocodeQueryValidatorSchema &
    AtlasReverseQueryValidatorSchema
>;

export type AuthenticatedUser = User & {
  business: Business | null;
  session: Session;
};

export interface AuthRequest<
  B = unknown,
  Q = QueryParameters,
> extends NextRequest {
  parsedBody?: B;
  query?: Q;
  params?: Record<string, string>;
  files?: Record<string, File>;
  /** The parsed multipart body, kept whole so routes can read repeated fields. */
  rawFormData?: FormData;
  validatedData?: B;
  user: AuthenticatedUser | null;
}

export interface ValidationResult {
  message?: string;
  statusCode: number;
  next: boolean;
  validatedData?: unknown;
  errors?: z.ZodError;
}
