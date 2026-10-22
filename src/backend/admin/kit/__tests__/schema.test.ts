import { describe, expect, it } from 'vitest';
import { listQuerySchema, writeSchema } from '../schema';
import { fixtureResource, registryWith } from './fixture';

type Schema = ReturnType<typeof writeSchema>;

const users = fixtureResource('users');
const clubs = fixtureResource('clubs');
const members = fixtureResource('members');

const ISO = '2026-10-22T14:32:00.000Z';

function passes(schema: Schema, input: unknown): boolean {
  return schema.safeParse(input).success;
}

/** The path of every issue, so a test can say where a body failed. */
function failedPaths(schema: Schema, input: unknown): unknown[][] {
  const result = schema.safeParse(input);
  if (result.success) return [];
  return result.error.issues.map((issue) => [...issue.path]);
}

function failedCodes(schema: Schema, input: unknown): string[] {
  const result = schema.safeParse(input);
  if (result.success) return [];
  return result.error.issues.map((issue) => issue.code);
}

function output(schema: Schema, input: unknown): unknown {
  const result = schema.safeParse(input);
  if (!result.success) throw result.error;
  const data: unknown = result.data;
  return data;
}

describe('writeSchema: create', () => {
  const create = writeSchema(users, 'create');

  it('accepts the required fields alone', () => {
    expect(passes(create, { email: 'a@b.co' })).toBe(true);
  });

  it('names a missing required field', () => {
    expect(failedPaths(create, {})).toEqual([['email']]);
  });

  it('rejects hidden and read-only keys as unrecognized', () => {
    expect(failedCodes(create, { email: 'a@b.co', passwordHash: 'x' })).toEqual(
      ['unrecognized_keys']
    );
    expect(
      failedCodes(create, {
        email: 'a@b.co',
        createdAt: '2026-01-01T00:00:00Z',
      })
    ).toEqual(['unrecognized_keys']);
    expect(failedCodes(create, { email: 'a@b.co', id: 'x' })).toEqual([
      'unrecognized_keys',
    ]);
  });

  it('checks wire types', () => {
    expect(failedPaths(create, { role: 'OWNER', email: 'x' })).toEqual([
      ['role'],
    ]);
    expect(passes(create, { email: 'x', role: 'ADMIN' })).toBe(true);
    expect(passes(create, { email: 'x', score: '12.50' })).toBe(true);
    expect(passes(create, { email: 'x', score: 12.5 })).toBe(true);
    expect(failedPaths(create, { email: 'x', score: 'abc' })).toEqual([
      ['score'],
    ]);
    expect(passes(create, { email: 'x', bio: null })).toBe(true);
    expect(passes(create, { email: '' })).toBe(true);
    expect(passes(create, { email: 'x', tags: ['a', 'b'] })).toBe(true);
    expect(passes(create, { email: 'x', tags: 'a' })).toBe(false);
    expect(passes(create, { email: 'x', role: null })).toBe(false);
    expect(passes(create, { email: 'x', payload: { any: ['json'] } })).toBe(
      true
    );
    expect(passes(create, { email: 'x', payload: null })).toBe(true);
  });

  it('checks booleans and keeps registry read-only fields out', () => {
    const create = writeSchema(clubs, 'create');
    expect(passes(create, { name: 'Run club', ownerId: 'u1' })).toBe(true);
    expect(passes(create, { name: 'x', ownerId: 'u1', isPublic: 'yes' })).toBe(
      false
    );
    expect(
      failedCodes(create, { name: 'x', ownerId: 'u1', memberCount: 3 })
    ).toEqual(['unrecognized_keys']);
  });

  it('takes an id without a default on create, as an int', () => {
    const blobs = fixtureResource(
      'blobs',
      registryWith([
        { key: 'blobs', model: 'Blob', group: 'Files', title: 'id' },
      ])
    );
    const create = writeSchema(blobs, 'create');
    expect(passes(create, { id: 3 })).toBe(true);
    expect(failedPaths(create, {})).toEqual([['id']]);
    expect(failedPaths(create, { id: 1.5 })).toEqual([['id']]);
    expect(failedPaths(create, { id: '3' })).toEqual([['id']]);
    expect(failedCodes(writeSchema(blobs, 'update'), { id: 3 })).toEqual([
      'unrecognized_keys',
    ]);
  });
});

describe('writeSchema: update', () => {
  const update = writeSchema(users, 'update');

  it('takes any subset of the writable fields', () => {
    expect(passes(update, {})).toBe(true);
    expect(passes(update, { name: 'Ada' })).toBe(true);
  });

  it('keeps non-nullable fields non-null', () => {
    expect(failedPaths(update, { email: null })).toEqual([['email']]);
  });

  it('never accepts an id', () => {
    expect(failedCodes(update, { id: 'x' })).toEqual(['unrecognized_keys']);
    const memberUpdate = writeSchema(members, 'update');
    expect(failedCodes(memberUpdate, { clubId: 'c2' })).toEqual([
      'unrecognized_keys',
    ]);
  });
});

describe('writeSchema: dates', () => {
  const update = writeSchema(members, 'update');

  it('accepts an ISO string and outputs a Date', () => {
    expect(output(update, { joinedAt: ISO })).toEqual({
      joinedAt: new Date(ISO),
    });
  });

  it('rejects anything that is not a date string', () => {
    expect(failedPaths(update, { joinedAt: 'yesterday' })).toEqual([
      ['joinedAt'],
    ]);
    expect(failedPaths(update, { joinedAt: 12 })).toEqual([['joinedAt']]);
  });
});

describe('writeSchema: required JSON', () => {
  const create = writeSchema(members, 'create');
  const body = { clubId: 'c1', userId: 'u1', joinedAt: ISO };

  it('names a missing required JSON field', () => {
    expect(failedPaths(create, body)).toEqual([['meta']]);
  });

  it('accepts any JSON value, falsy ones included', () => {
    expect(passes(create, { ...body, meta: { a: 1 } })).toBe(true);
    expect(passes(create, { ...body, meta: 0 })).toBe(true);
    expect(passes(create, { ...body, meta: false })).toBe(true);
    expect(passes(create, { ...body, meta: '' })).toBe(true);
  });

  it('keeps a non-nullable JSON field non-null', () => {
    expect(failedPaths(create, { ...body, meta: null })).toEqual([['meta']]);
    const update = writeSchema(members, 'update');
    expect(passes(update, {})).toBe(true);
    expect(failedPaths(update, { meta: null })).toEqual([['meta']]);
  });
});

describe('listQuerySchema', () => {
  const list = listQuerySchema(users);

  it('defaults the page and size', () => {
    expect(output(list, {})).toEqual({ page: 1, size: 20 });
  });

  it('parses query strings', () => {
    expect(
      output(list, {
        page: '2',
        size: '50',
        query: 'ada',
        sortBy: 'email',
        sortOrder: 'asc',
        role: 'ADMIN',
      })
    ).toEqual({
      page: 2,
      size: 50,
      query: 'ada',
      sortBy: 'email',
      sortOrder: 'asc',
      role: 'ADMIN',
    });
  });

  it('rejects bad, hidden and unknown parameters', () => {
    expect(passes(list, { size: '101' })).toBe(false);
    expect(passes(list, { size: '0' })).toBe(false);
    expect(passes(list, { page: '0' })).toBe(false);
    expect(passes(list, { page: '1.5' })).toBe(false);
    expect(passes(list, { page: 'two' })).toBe(false);
    expect(passes(list, { query: 'x'.repeat(256) })).toBe(false);
    expect(passes(list, { sortBy: 'passwordHash' })).toBe(false);
    expect(passes(list, { sortBy: 'tags' })).toBe(false);
    expect(passes(list, { sortOrder: 'up' })).toBe(false);
    expect(passes(list, { passwordHash: 'x' })).toBe(false);
    expect(passes(list, { role: 'OWNER' })).toBe(false);
    expect(passes(list, { nope: '1' })).toBe(false);
  });

  it('parses boolean and foreign key filters', () => {
    const clubList = listQuerySchema(clubs);
    expect(output(clubList, { isPublic: 'true' })).toEqual({
      page: 1,
      size: 20,
      isPublic: true,
    });
    expect(output(clubList, { isPublic: 'false' })).toEqual({
      page: 1,
      size: 20,
      isPublic: false,
    });
    expect(passes(clubList, { isPublic: 'yes' })).toBe(false);
    expect(output(clubList, { ownerId: 'u1' })).toEqual({
      page: 1,
      size: 20,
      ownerId: 'u1',
    });
    expect(passes(clubList, { ownerId: '' })).toBe(false);
  });
});
