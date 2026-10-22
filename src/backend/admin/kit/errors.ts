import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@/utils/exceptions';
import { Prisma } from '../prisma';
import type { AdminCan, AdminResource } from './types';

const STILL_REFERENCED = 'Other records still point at this one';

const PAST_TENSE: Record<keyof AdminCan, string> = {
  create: 'created',
  update: 'changed',
  delete: 'deleted',
};

/** The Prisma error code, or null for anything that isn't a known request error. */
export function prismaCode(error: unknown): string | null {
  return error instanceof Prisma.PrismaClientKnownRequestError
    ? error.code
    : null;
}

/** 404 for a bad key or a missing record: "User not found". */
export function notFound(resource: AdminResource): NotFoundException {
  return new NotFoundException(`${resource.singular} not found`);
}

/** 403 for an action the resource doesn't allow: "Sessions can't be created here". */
export function forbidden(
  resource: AdminResource,
  action: keyof AdminCan
): ForbiddenException {
  return new ForbiddenException(
    `${resource.label} can't be ${PAST_TENSE[action]} here`
  );
}

/**
 * The spec §6.6 status for a Prisma error, as one of the product's
 * `HttpException`s. Anything else comes back unchanged, so it stays a 500.
 */
export function toHttpException(
  error: unknown,
  resource: AdminResource
): unknown {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return error;
  switch (error.code) {
    // A unique clash.
    case 'P2002': {
      const fields = clashingFields(error.meta?.target, resource);
      return new ConflictException(
        fields.length > 0
          ? `${fields.join(', ')}: already in use`
          : 'A value is already in use'
      );
    }
    // A foreign key or required relation still points at the row.
    case 'P2003':
    case 'P2014':
      return new ConflictException(STILL_REFERENCED);
    // A value too large for its column.
    case 'P2020':
      return new UnprocessableEntityException('A value is out of range');
    // A malformed id value (a composite key part, a foreign key filter), or
    // the row went away between the read and the write.
    case 'P2023':
    case 'P2025':
      return notFound(resource);
    default:
      return error;
  }
}

/**
 * The fields a unique clash names. PostgreSQL lists them; MongoDB names the
 * index instead (`User_email_key`), so its fields are read back from it.
 */
function clashingFields(target: unknown, resource: AdminResource): string[] {
  if (Array.isArray(target)) {
    const names: unknown[] = target;
    return names.filter((name): name is string => typeof name === 'string');
  }
  if (typeof target !== 'string') return [];
  const index = `_${target.replace(/_key$/, '')}_`;
  return resource.fields
    .map((field) => field.name)
    .filter((name) => index.includes(`_${name}_`));
}
