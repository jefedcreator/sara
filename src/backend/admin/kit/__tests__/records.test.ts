import { describe, expect, it } from 'vitest';
import { encodeKey } from '../keys';
import { resolveRegistry } from '../policy';
import { toAdminRecord } from '../records';
import {
  clubsPolicy,
  dm,
  fixtureRegistry,
  membersPolicy,
  registryWith,
  resourceIn,
  usersPolicy,
} from './fixture';

const resolved = resolveRegistry(fixtureRegistry, dm);
const clubs = resourceIn(resolved, 'clubs');
const members = resourceIn(resolved, 'members');

const clubRow = {
  id: 'c1',
  name: 'Lagos Runners',
  ownerId: 'u1',
  owner: { id: 'u1', email: 'ada@x.co' },
  isPublic: true,
  memberCount: 3,
};

describe('toAdminRecord', () => {
  it('keeps the exposed fields and adds the key, title and refs', () => {
    const record = toAdminRecord(clubs, clubRow, resolved);
    expect(record).toEqual({
      id: 'c1',
      name: 'Lagos Runners',
      ownerId: 'u1',
      isPublic: true,
      memberCount: 3,
      _key: 'c1',
      _title: 'Lagos Runners',
      _refs: { ownerId: { key: 'u1', title: 'ada@x.co' } },
    });
    expect(record).not.toHaveProperty('owner');
  });

  it('titles a join row by its foreign key reference', () => {
    const joinedAt = new Date('2026-10-01T08:00:00.000Z');
    const record = toAdminRecord(
      members,
      {
        clubId: 'c1',
        club: { id: 'c1', name: 'Lagos Runners' },
        userId: 'u1',
        user: { id: 'u1', email: 'ada@x.co' },
        joinedAt,
        meta: { source: 'invite' },
      },
      resolved
    );
    expect(record._title).toBe('ada@x.co');
    expect(record._key).toBe(
      encodeKey(members, { clubId: 'c1', userId: 'u1' })
    );
    expect(record._refs).toEqual({
      clubId: { key: 'c1', title: 'Lagos Runners' },
      userId: { key: 'u1', title: 'ada@x.co' },
    });
    expect(record.joinedAt).toBe(joinedAt);
    expect(record.meta).toEqual({ source: 'invite' });
    expect(record).not.toHaveProperty('user');
    expect(record).not.toHaveProperty('club');
  });

  it('falls back to the key when the title is empty', () => {
    const record = toAdminRecord(clubs, { ...clubRow, name: '' }, resolved);
    expect(record._title).toBe('c1');
  });

  it('falls back to the key when a reference title is empty', () => {
    const record = toAdminRecord(
      clubs,
      { ...clubRow, owner: { id: 'u1', email: '' } },
      resolved
    );
    expect(record._refs.ownerId).toEqual({ key: 'u1', title: 'u1' });
  });

  it('gives a null ref for a null foreign key', () => {
    const record = toAdminRecord(
      clubs,
      { ...clubRow, ownerId: null, owner: null },
      resolved
    );
    expect(record._refs).toEqual({ ownerId: null });
    expect(record.ownerId).toBeNull();
  });

  it('takes a reference title that is itself a foreign key as its raw value', () => {
    const registry = resolveRegistry(
      registryWith([
        usersPolicy,
        { ...clubsPolicy, title: 'ownerId' },
        membersPolicy,
      ]),
      dm
    );
    const record = toAdminRecord(
      resourceIn(registry, 'members'),
      {
        clubId: 'c1',
        club: { id: 'c1', ownerId: 'u2' },
        userId: 'u1',
        user: { id: 'u1', email: 'ada@x.co' },
        joinedAt: new Date('2026-10-01T08:00:00.000Z'),
        meta: {},
      },
      registry
    );
    expect(record._refs.clubId).toEqual({ key: 'c1', title: 'u2' });
  });
});
