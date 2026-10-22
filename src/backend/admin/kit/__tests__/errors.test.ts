import { describe, expect, it } from 'vitest';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@/utils/exceptions';
import { Prisma } from '../../prisma';
import { forbidden, notFound, prismaCode, toHttpException } from '../errors';
import { fixtureResource } from './fixture';

const users = fixtureResource('users');
const members = fixtureResource('members');

function prismaError(
  code: string,
  meta?: Record<string, unknown>
): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(`prisma ${code}`, {
    code,
    clientVersion: 'x',
    meta,
  });
}

describe('toHttpException', () => {
  it('names the field of a unique clash', () => {
    const error = toHttpException(
      prismaError('P2002', { target: ['email'] }),
      users
    );
    expect(error).toBeInstanceOf(ConflictException);
    expect(error).toMatchObject({
      message: 'email: already in use',
      statusCode: 409,
    });
  });

  it('reads the fields back from a MongoDB index name', () => {
    expect(
      toHttpException(prismaError('P2002', { target: 'User_email_key' }), users)
    ).toMatchObject({ message: 'email: already in use', statusCode: 409 });
    expect(
      toHttpException(
        prismaError('P2002', { target: 'Member_clubId_userId_key' }),
        members
      )
    ).toMatchObject({ message: 'clubId, userId: already in use' });
  });

  it('still answers 409 when the clash names no known field', () => {
    const error = toHttpException(prismaError('P2002'), users);
    expect(error).toBeInstanceOf(ConflictException);
    expect(error).toMatchObject({ message: 'A value is already in use' });
  });

  it('answers 409 when other records still point at the row', () => {
    for (const code of ['P2003', 'P2014']) {
      const error = toHttpException(prismaError(code), users);
      expect(error).toBeInstanceOf(ConflictException);
      expect(error).toMatchObject({
        message: 'Other records still point at this one',
        statusCode: 409,
      });
    }
  });

  it('answers 404 for a missing row or a malformed id value', () => {
    for (const code of ['P2025', 'P2023']) {
      const error = toHttpException(prismaError(code), users);
      expect(error).toBeInstanceOf(NotFoundException);
      expect(error).toMatchObject({
        message: 'User not found',
        statusCode: 404,
      });
    }
  });

  it('answers 422 for a value out of range', () => {
    const error = toHttpException(prismaError('P2020'), users);
    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect(error).toMatchObject({ statusCode: 422 });
  });

  it('passes anything else through unchanged', () => {
    const plain = new Error('boom');
    expect(toHttpException(plain, users)).toBe(plain);
    const other = prismaError('P2034');
    expect(toHttpException(other, users)).toBe(other);
    expect(toHttpException('text', users)).toBe('text');
  });
});

describe('error helpers', () => {
  it('reads a Prisma error code', () => {
    expect(prismaCode(prismaError('P2023'))).toBe('P2023');
    expect(prismaCode(new Error('boom'))).toBeNull();
  });

  it('words 404 and 403 for the resource', () => {
    expect(notFound(members).message).toBe('Member not found');
    const error = forbidden(users, 'create');
    expect(error).toBeInstanceOf(ForbiddenException);
    expect(error.message).toBe("Users can't be created here");
    expect(forbidden(users, 'update').message).toBe(
      "Users can't be changed here"
    );
    expect(forbidden(users, 'delete').message).toBe(
      "Users can't be deleted here"
    );
  });
});
