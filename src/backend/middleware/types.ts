import type { User } from '@prisma/client';
import { type NextRequest } from 'next/server';
import type z from 'zod';
import type { ClubQueryValidatorSchema } from '../validators/club.validator';
import type { LeaderboardQueryValidatorSchema } from '../validators/leaderboard.validator';
import type { ExploreQueryValidatorSchema } from '../validators/explore.validator';
import type { NotificationQueryValidatorSchema } from '../validators/notification.validator';
import type { BaseQueryValidatorSchema } from '../validators/index.validator';

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
  BaseQueryValidatorSchema &
    LeaderboardQueryValidatorSchema &
    ClubQueryValidatorSchema &
    ExploreQueryValidatorSchema &
    NotificationQueryValidatorSchema
>;

export interface AuthRequest<B = unknown, Q = QueryParameters>
  extends NextRequest {
  parsedBody?: B;
  query?: Q;
  params?: Record<string, string>;
  files?: Record<string, File>;
  validatedData?: B;
  user: User | null;
  isExpired?: boolean;
}

export interface ValidationResult {
  message?: string;
  statusCode: number;
  next: boolean;
  validatedData?: unknown;
  errors?: z.ZodError;
}
