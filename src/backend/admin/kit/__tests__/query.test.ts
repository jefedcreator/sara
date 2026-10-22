import { describe, expect, it } from 'vitest';
import { resolveRegistry } from '../policy';
import { listArgs, selectFor, whereFor } from '../query';
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
const users = resourceIn(resolved, 'users');
const clubs = resourceIn(resolved, 'clubs');
const members = resourceIn(resolved, 'members');

const UUID = '0b8e5d2c-9f1a-4c3e-8a7b-6d5e4f3a2b1c';

function search(text: string) {
  return [
    { email: { contains: text, mode: 'insensitive' } },
    { name: { contains: text, mode: 'insensitive' } },
  ];
}

describe('selectFor', () => {
  it('selects every exposed field and each reference id and title', () => {
    expect(selectFor(clubs, resolved)).toEqual({
      id: true,
      name: true,
      ownerId: true,
      isPublic: true,
      memberCount: true,
      owner: { select: { id: true, email: true } },
    });
  });

  it('never selects a secret field or an unregistered relation', () => {
    const select = selectFor(users, resolved);
    expect(select).not.toHaveProperty('passwordHash');
    expect(select).not.toHaveProperty('clubs');
    expect(Object.keys(select)).toEqual(
      users.fields.map((field) => field.name)
    );
  });

  it('selects both references of a join row', () => {
    expect(selectFor(members, resolved)).toEqual({
      clubId: true,
      userId: true,
      joinedAt: true,
      meta: true,
      club: { select: { id: true, name: true } },
      user: { select: { id: true, email: true } },
    });
  });

  it('takes a target title that is itself a foreign key as its raw value', () => {
    const registry = resolveRegistry(
      registryWith([
        usersPolicy,
        { ...clubsPolicy, title: 'ownerId' },
        membersPolicy,
      ]),
      dm
    );
    const select = selectFor(resourceIn(registry, 'members'), registry);
    expect(select.club).toEqual({ select: { id: true, ownerId: true } });
  });
});

describe('whereFor', () => {
  it('searches the searchable fields, case-insensitively', () => {
    expect(whereFor(users, { page: 1, size: 20, query: 'ada' })).toEqual({
      AND: [{ OR: search('ada') }],
    });
  });

  it('also matches the id when the query is a well-formed one', () => {
    expect(whereFor(users, { page: 1, size: 20, query: UUID })).toEqual({
      AND: [{ OR: [...search(UUID), { id: UUID }] }],
    });
    expect(
      whereFor(users, { page: 1, size: 20, query: '0b8e5d2c-zzzz' })
    ).toEqual({ AND: [{ OR: search('0b8e5d2c-zzzz') }] });
  });

  it('never matches a composite id from the query', () => {
    expect(whereFor(members, { page: 1, size: 20, query: 'u1' })).toEqual({
      AND: [{ OR: [] }],
    });
  });

  it('treats a blank query as no query', () => {
    expect(whereFor(users, { page: 1, size: 20, query: '' })).toEqual({});
    expect(whereFor(users, { page: 1, size: 20, query: '   ' })).toEqual({});
  });

  it('ANDs each filter, false included', () => {
    expect(whereFor(users, { page: 1, size: 20, role: 'ADMIN' })).toEqual({
      AND: [{ role: 'ADMIN' }],
    });
    expect(
      whereFor(clubs, { page: 1, size: 20, ownerId: 'u1', isPublic: false })
    ).toEqual({ AND: [{ ownerId: 'u1' }, { isPublic: false }] });
  });

  it('ANDs the search with the filters', () => {
    expect(
      whereFor(users, { page: 1, size: 20, query: 'ada', role: 'MEMBER' })
    ).toEqual({ AND: [{ OR: search('ada') }, { role: 'MEMBER' }] });
  });

  it('ignores a key that is not filterable', () => {
    expect(whereFor(users, { page: 1, size: 20, passwordHash: 'x' })).toEqual(
      {}
    );
  });
});

describe('listArgs', () => {
  it('pages and sorts by the default, then the id', () => {
    expect(listArgs(users, { page: 3, size: 20 }, resolved)).toEqual({
      where: {},
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      skip: 40,
      take: 20,
      select: selectFor(users, resolved),
    });
    expect(listArgs(users, { page: 1, size: 5 }, resolved)).toMatchObject({
      skip: 0,
      take: 5,
    });
  });

  it('sorts by the chosen field, ascending unless told otherwise', () => {
    expect(
      listArgs(users, { page: 1, size: 20, sortBy: 'email' }, resolved).orderBy
    ).toEqual([{ email: 'asc' }, { id: 'asc' }]);
    expect(
      listArgs(
        users,
        { page: 1, size: 20, sortBy: 'email', sortOrder: 'desc' },
        resolved
      ).orderBy
    ).toEqual([{ email: 'desc' }, { id: 'asc' }]);
    expect(
      listArgs(users, { page: 1, size: 20, sortOrder: 'asc' }, resolved).orderBy
    ).toEqual([{ createdAt: 'asc' }, { id: 'asc' }]);
  });

  it('breaks ties on a non-unique sort by the id', () => {
    expect(
      listArgs(users, { page: 1, size: 20, sortBy: 'role' }, resolved).orderBy
    ).toEqual([{ role: 'asc' }, { id: 'asc' }]);
    expect(
      listArgs(clubs, { page: 2, size: 20, sortBy: 'isPublic' }, resolved)
        .orderBy
    ).toEqual([{ isPublic: 'asc' }, { id: 'asc' }]);
  });

  it('never repeats the id when it is the sort', () => {
    expect(
      listArgs(
        users,
        { page: 1, size: 20, sortBy: 'id', sortOrder: 'desc' },
        resolved
      ).orderBy
    ).toEqual([{ id: 'desc' }]);
    expect(listArgs(clubs, { page: 1, size: 20 }, resolved).orderBy).toEqual([
      { id: 'asc' },
    ]);
  });

  it('breaks ties by every part of a compound id', () => {
    expect(listArgs(members, { page: 1, size: 20 }, resolved).orderBy).toEqual([
      { clubId: 'asc' },
      { userId: 'asc' },
    ]);
    expect(
      listArgs(members, { page: 1, size: 20, sortBy: 'joinedAt' }, resolved)
        .orderBy
    ).toEqual([{ joinedAt: 'asc' }, { clubId: 'asc' }, { userId: 'asc' }]);
  });

  it('carries the where', () => {
    expect(
      listArgs(users, { page: 1, size: 20, role: 'ADMIN' }, resolved).where
    ).toEqual({ AND: [{ role: 'ADMIN' }] });
  });
});
