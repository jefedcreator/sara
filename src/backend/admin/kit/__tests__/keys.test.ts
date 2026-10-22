import { describe, expect, it } from 'vitest';
import { encodeKey, whereForKey } from '../keys';
import type { AdminResource } from '../types';
import { fixtureResource } from './fixture';

const users = fixtureResource('users');
const members = fixtureResource('members');

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

describe('encodeKey', () => {
  it('uses a single id as it is', () => {
    expect(encodeKey(users, { id: 'u1', email: 'a@b.co' })).toBe('u1');
  });

  it('encodes a composite id as base64url JSON in @@id order', () => {
    expect(encodeKey(members, { userId: 'u1', clubId: 'c1' })).toBe(
      base64url(['c1', 'u1'])
    );
  });
});

describe('whereForKey', () => {
  it('reads a well-formed single id', () => {
    const id = '0b8e5d2c-9f1a-4c3e-8a7b-6d5e4f3a2b1c';
    expect(whereForKey(users, id)).toEqual({ id });
  });

  it('reads a composite key back into its compound where', () => {
    const key = encodeKey(members, { clubId: 'c1', userId: 'u1' });
    expect(key).toBe(base64url(['c1', 'u1']));
    expect(whereForKey(members, key)).toEqual({
      clubId_userId: { clubId: 'c1', userId: 'u1' },
    });
  });

  it('rejects a malformed UUID or ObjectId', () => {
    expect(whereForKey(users, 'not-a-uuid')).toBeNull();
    const objectIds: AdminResource = { ...users, idFormat: 'objectid' };
    expect(whereForKey(objectIds, 'xyz')).toBeNull();
    expect(whereForKey(objectIds, '507f1f77bcf86cd799439011')).toEqual({
      id: '507f1f77bcf86cd799439011',
    });
  });

  it('rejects a composite key that does not decode to the right shape', () => {
    expect(whereForKey(members, '%%%')).toBeNull();
    expect(
      whereForKey(members, Buffer.from('not json').toString('base64url'))
    ).toBeNull();
    expect(whereForKey(members, base64url({ clubId: 'c1' }))).toBeNull();
    expect(whereForKey(members, base64url(['c1']))).toBeNull();
    expect(whereForKey(members, base64url(['c1', 'u1', 'x']))).toBeNull();
    expect(whereForKey(members, base64url([1, 'u1']))).toBeNull();
  });

  it('reads an int id and rejects anything else', () => {
    const counters: AdminResource = {
      ...users,
      idKinds: { id: 'int' },
      idFormat: 'any',
    };
    expect(whereForKey(counters, '42')).toEqual({ id: 42 });
    expect(whereForKey(counters, '4x')).toBeNull();
    expect(whereForKey(counters, '')).toBeNull();
  });
});
