import type { User, Session, Business } from '@prisma/client';
import { type NextRequest } from 'next/server';
import type z from 'zod';
import type { BaseQueryValidatorSchema } from '../validators/index.validator';
import type { InvoiceQueryValidatorSchema } from '../validators/invoice.validator';
import type { ReceiptQueryValidatorSchema } from '../validators/receipt.validator';

export type MiddlewareResponse = {
  message: string;
  statusCode: number;
  next: boolean;
  redirect?: string;
};

export type MiddlewareFunction<B = unknown, Q = QueryParameters> = (
  req: AuthRequest<B, Q>
) => Promise<MiddlewareResponse>;

export interface I_JwtPayload {
  workspaceId: string;
  email: string;
  uid: string;
  permissions: any;
}

type Prettify<T> = {
  [K in keyof T]: T[K];
} & {};

export type QueryParameters = Prettify<
  BaseQueryValidatorSchema & InvoiceQueryValidatorSchema & ReceiptQueryValidatorSchema
>;

export type AuthenticatedUser = User & {
  business: Business | null;
  session: Session;
};

export interface AuthRequest<B = unknown, Q = QueryParameters>
  extends NextRequest {
  parsedBody?: B;
  query?: Q;
  params?: Record<string, string>;
  files?: Record<string, File>;
  validatedData?: B;
  user: AuthenticatedUser | null;
  isExpired?: boolean;
}

export interface ValidationResult {
  message?: string;
  statusCode: number;
  next: boolean;
  validatedData?: unknown;
  errors?: z.ZodError;
}
