import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@/utils/exceptions';
import { Prisma, jsonNull } from '../../prisma';
import { encodeKey } from '../keys';
import { type ResourceHooks, resolveRegistry } from '../policy';
import {
  createRecord,
  deleteRecord,
  listRecords,
  readManifest,
  readRecord,
  updateRecord,
} from '../service';
import type { ResolvedRegistry } from '../types';
import {
  clubsPolicy,
  dm,
  fixtureRegistry,
  membersPolicy,
  registryWith,
  resourceIn,
  usersPolicy,
} from './fixture';

// The Prisma client is an object of model delegates; the service only reaches
// it through `db[resource.delegate]`, so a plain object stands in for it.
const db = vi.hoisted(() => {
  const delegates: Record<string, unknown> = {};
  return delegates;
});

vi.mock('@/server/db', () => ({ db }));

// Each product's `jsonNull` is its own (a plain null on MongoDB, DbNull on
// PostgreSQL). A sentinel stands in for it, so the test proves the service
// writes `jsonNull` for a JSON null, whatever the product's value is.
const sentinel = vi.hoisted(() => ({ jsonNull: { sentinel: 'jsonNull' } }));

vi.mock('../../prisma', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { Prisma: actual.Prisma, jsonNull: sentinel.jsonNull };
});

// ─── An in-memory database ─────────────────────────────────────────────────────

type Row = Record<string, unknown>;

/** Each table's rows, keyed by delegate name. */
let tables: Record<string, Row[]> = {};

/** Relation field → the table it reads and the foreign key it follows. */
const LINKS: Record<string, { table: string; key: string }> = {
  owner: { table: 'user', key: 'ownerId' },
  user: { table: 'user', key: 'userId' },
  club: { table: 'club', key: 'clubId' },
};

function isRow(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A plain or compound (`{ clubId_userId: { … } }`) unique where. */
function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([name, value]) =>
    isRow(value) ? matches(row, value) : row[name] === value
  );
}

/** Applies a Prisma select, following one level of relation selects. */
function project(row: Row, select: Row): Row {
  const out: Row = {};
  for (const [name, spec] of Object.entries(select)) {
    if (spec === true) {
      out[name] = row[name] ?? null;
      continue;
    }
    const link = LINKS[name];
    const nested = isRow(spec) ? spec.select : undefined;
    if (!link || !isRow(nested)) continue;
    const target = (tables[link.table] ?? []).find(
      (item) => item.id === row[link.key]
    );
    out[name] = target ? project(target, nested) : null;
  }
  return out;
}

function prismaError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(`prisma ${code}`, {
    code,
    clientVersion: 'x',
  });
}

function memoryDelegate(table: string) {
  const rows = (): Row[] => tables[table] ?? [];
  return {
    findMany: vi.fn((args: { select: Row; skip: number; take: number }) =>
      Promise.resolve(
        rows()
          .slice(args.skip, args.skip + args.take)
          .map((row) => project(row, args.select))
      )
    ),
    findUnique: vi.fn((args: { where: Row; select: Row }) => {
      const row = rows().find((item) => matches(item, args.where));
      return Promise.resolve(row ? project(row, args.select) : null);
    }),
    count: vi.fn((_args: Row) => Promise.resolve(rows().length)),
    create: vi.fn((args: { data: Row; select: Row }) => {
      const row: Row = { id: `${table}-${rows().length + 1}` };
      Object.assign(row, args.data);
      rows().push(row);
      return Promise.resolve(project(row, args.select));
    }),
    update: vi.fn((args: { where: Row; data: Row; select: Row }) => {
      const row = rows().find((item) => matches(item, args.where));
      if (!row) return Promise.reject(prismaError('P2025'));
      Object.assign(row, args.data);
      return Promise.resolve(project(row, args.select));
    }),
    delete: vi.fn((args: { where: Row; select: Row }) => {
      const list = rows();
      const index = list.findIndex((item) => matches(item, args.where));
      const row = list[index];
      if (!row) return Promise.reject(prismaError('P2025'));
      list.splice(index, 1);
      return Promise.resolve(project(row, args.select));
    }),
  };
}

// ─── Fixture data ──────────────────────────────────────────────────────────────

// `expect.objectContaining` is typed `any`; this returns it as `unknown` so it
// can sit in an expected-call object without an unsafe assignment.
function rowLike(fields: Row): unknown {
  const matcher: unknown = expect.objectContaining(fields);
  return matcher;
}

const ADA = '0b8e5d2c-9f1a-4c3e-8a7b-6d5e4f3a2b1c';
const NOBODY = '9c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f';

const resolved = resolveRegistry(fixtureRegistry, dm);

/** The fixture registry with these hooks on `clubs`. */
function withClubHooks(hooks: ResourceHooks): ResolvedRegistry {
  return resolveRegistry(
    registryWith([usersPolicy, { ...clubsPolicy, hooks }, membersPolicy]),
    dm
  );
}

let user: ReturnType<typeof memoryDelegate>;
let club: ReturnType<typeof memoryDelegate>;
let member: ReturnType<typeof memoryDelegate>;

beforeEach(() => {
  tables = {
    user: [
      {
        id: ADA,
        email: 'ada@x.co',
        passwordHash: 'secret',
        name: 'Ada',
        role: 'ADMIN',
        tags: [],
        payload: { theme: 'dark' },
      },
    ],
    club: [
      {
        id: 'c1',
        name: 'Lagos Runners',
        ownerId: ADA,
        isPublic: true,
        memberCount: 1,
      },
    ],
    member: [
      {
        clubId: 'c1',
        userId: ADA,
        joinedAt: new Date('2026-10-01T08:00:00.000Z'),
        meta: {},
      },
    ],
  };
  user = memoryDelegate('user');
  club = memoryDelegate('club');
  member = memoryDelegate('member');
  db.user = user;
  db.club = club;
  db.member = member;
});

// ─── Reads ─────────────────────────────────────────────────────────────────────

describe('readManifest', () => {
  it('counts every resource', async () => {
    const manifest = await readManifest(resolved);
    expect(manifest.resources.map((resource) => resource.count)).toEqual([
      1, 1, 1,
    ]);
  });
});

describe('listRecords', () => {
  it('returns records and the total', async () => {
    const page = await listRecords(resolved, resourceIn(resolved, 'clubs'), {
      page: 1,
      size: 20,
    });
    expect(page.total).toBe(1);
    expect(page.data[0]).toMatchObject({
      _key: 'c1',
      _title: 'Lagos Runners',
      _refs: { ownerId: { key: ADA, title: 'ada@x.co' } },
    });
    expect(club.findMany.mock.calls[0]?.[0]).toMatchObject({
      skip: 0,
      take: 20,
    });
  });
});

describe('readRecord', () => {
  it('reads a record by its key, never selecting a secret', async () => {
    const record = await readRecord(
      resolved,
      resourceIn(resolved, 'users'),
      ADA
    );
    expect(record).toMatchObject({ _key: ADA, _title: 'ada@x.co' });
    expect(record).not.toHaveProperty('passwordHash');
    expect(user.findUnique.mock.calls[0]?.[0].select).not.toHaveProperty(
      'passwordHash'
    );
  });

  it('reads a composite key', async () => {
    const members = resourceIn(resolved, 'members');
    const key = encodeKey(members, { clubId: 'c1', userId: ADA });
    const record = await readRecord(resolved, members, key);
    expect(record).toMatchObject({ _key: key, _title: 'ada@x.co' });
  });

  it('answers 404 for a malformed key without touching the database', async () => {
    await expect(
      readRecord(resolved, resourceIn(resolved, 'users'), 'not-a-uuid')
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      readRecord(resolved, resourceIn(resolved, 'members'), '%%%')
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(user.findUnique).not.toHaveBeenCalled();
    expect(member.findUnique).not.toHaveBeenCalled();
  });

  it('answers 404 for a missing record', async () => {
    await expect(
      readRecord(resolved, resourceIn(resolved, 'users'), NOBODY)
    ).rejects.toMatchObject({ message: 'User not found', statusCode: 404 });
  });

  it('answers 404 when Prisma rejects an id value as malformed', async () => {
    club.findUnique.mockRejectedValueOnce(prismaError('P2023'));
    await expect(
      readRecord(resolved, resourceIn(resolved, 'clubs'), 'c1')
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

// ─── Writes ────────────────────────────────────────────────────────────────────

describe('createRecord', () => {
  it('answers 422 for a foreign key that names no record, before any write', async () => {
    const clubs = resourceIn(resolved, 'clubs');
    const error = await createRecord(resolved, clubs, {
      name: 'Abuja Striders',
      ownerId: 'missing',
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect(error).toMatchObject({ message: 'ownerId: no such user' });

    await expect(
      createRecord(resolved, clubs, { name: 'Abuja Striders', ownerId: NOBODY })
    ).rejects.toMatchObject({ message: 'ownerId: no such user' });

    user.findUnique.mockRejectedValueOnce(prismaError('P2023'));
    await expect(
      createRecord(resolved, clubs, { name: 'Abuja Striders', ownerId: ADA })
    ).rejects.toMatchObject({ message: 'ownerId: no such user' });

    expect(club.create).not.toHaveBeenCalled();
  });

  it('creates a record with its references', async () => {
    const record = await createRecord(resolved, resourceIn(resolved, 'clubs'), {
      name: 'Abuja Striders',
      ownerId: ADA,
    });
    expect(record._title).toBe('Abuja Striders');
    expect(record._refs.ownerId?.title).toBe('ada@x.co');
    expect(tables.club).toHaveLength(2);
  });

  it('writes what beforeWrite returns', async () => {
    const beforeWrite = vi.fn<NonNullable<ResourceHooks['beforeWrite']>>(
      (data) => ({ ...data, isPublic: false })
    );
    const registry = withClubHooks({ beforeWrite });
    await createRecord(registry, resourceIn(registry, 'clubs'), {
      name: 'Abuja Striders',
      ownerId: ADA,
    });
    expect(beforeWrite).toHaveBeenCalledWith(
      { name: 'Abuja Striders', ownerId: ADA },
      'create'
    );
    expect(club.create.mock.calls[0]?.[0].data).toEqual({
      name: 'Abuja Striders',
      ownerId: ADA,
      isPublic: false,
    });
  });

  it('runs afterWrite with the new row', async () => {
    const afterWrite = vi.fn<NonNullable<ResourceHooks['afterWrite']>>(() =>
      Promise.resolve()
    );
    const registry = withClubHooks({ afterWrite });
    await createRecord(registry, resourceIn(registry, 'clubs'), {
      name: 'Abuja Striders',
      ownerId: ADA,
    });
    expect(afterWrite).toHaveBeenCalledWith({
      mode: 'create',
      before: null,
      after: rowLike({ name: 'Abuja Striders' }),
    });
  });

  it("stores JSON null on a nullable JSON field as the product's jsonNull", async () => {
    await createRecord(resolved, resourceIn(resolved, 'users'), {
      email: 'grace@x.co',
      payload: null,
      name: null,
    });
    const data = user.create.mock.calls[0]?.[0].data;
    // The key reaches the delegate, holding exactly the mocked jsonNull.
    expect(data).toHaveProperty('payload');
    expect(data?.payload).toBe(jsonNull);
    expect(data?.payload).toBe(sentinel.jsonNull);
    // A null on any other field stays a plain null.
    expect(data?.name).toBeNull();
  });

  it('passes a JSON value through unchanged', async () => {
    await updateRecord(resolved, resourceIn(resolved, 'users'), ADA, {
      payload: { theme: 'light' },
    });
    expect(user.update.mock.calls[0]?.[0].data).toEqual({
      payload: { theme: 'light' },
    });
  });

  it('answers 403 on a sign-in resource', async () => {
    const registry = resolveRegistry(
      registryWith([
        { ...usersPolicy, signIn: true },
        clubsPolicy,
        membersPolicy,
      ]),
      dm
    );
    const error = await createRecord(registry, resourceIn(registry, 'users'), {
      email: 'grace@x.co',
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ForbiddenException);
    expect(error).toMatchObject({ message: "Users can't be created here" });
    expect(user.create).not.toHaveBeenCalled();
  });

  it('answers 409 on a unique clash', async () => {
    user.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('unique', {
        code: 'P2002',
        clientVersion: 'x',
        meta: { target: ['email'] },
      })
    );
    await expect(
      createRecord(resolved, resourceIn(resolved, 'users'), {
        email: 'ada@x.co',
      })
    ).rejects.toMatchObject({
      message: 'email: already in use',
      statusCode: 409,
    });
  });
});

describe('updateRecord', () => {
  it('changes the row and runs afterWrite with before and after', async () => {
    const afterWrite = vi.fn<NonNullable<ResourceHooks['afterWrite']>>(() =>
      Promise.resolve()
    );
    const registry = withClubHooks({ afterWrite });
    const record = await updateRecord(
      registry,
      resourceIn(registry, 'clubs'),
      'c1',
      { name: 'Lagos Road Runners' }
    );
    expect(record._title).toBe('Lagos Road Runners');
    expect(afterWrite).toHaveBeenCalledWith({
      mode: 'update',
      before: rowLike({ name: 'Lagos Runners' }),
      after: rowLike({ name: 'Lagos Road Runners' }),
    });
  });

  it('answers 404 for a missing record before checking anything else', async () => {
    await expect(
      updateRecord(resolved, resourceIn(resolved, 'clubs'), 'c9', {
        ownerId: 'missing',
      })
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(club.update).not.toHaveBeenCalled();
  });

  it('answers 422 for a foreign key that names no record', async () => {
    await expect(
      updateRecord(resolved, resourceIn(resolved, 'clubs'), 'c1', {
        ownerId: NOBODY,
      })
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(club.update).not.toHaveBeenCalled();
  });

  it('answers 404 when the row goes away before the write', async () => {
    club.update.mockRejectedValueOnce(prismaError('P2025'));
    await expect(
      updateRecord(resolved, resourceIn(resolved, 'clubs'), 'c1', {
        name: 'Gone',
      })
    ).rejects.toMatchObject({ message: 'Club not found', statusCode: 404 });
  });
});

describe('deleteRecord', () => {
  it('deletes the row and runs afterWrite with it', async () => {
    const afterWrite = vi.fn<NonNullable<ResourceHooks['afterWrite']>>(() =>
      Promise.resolve()
    );
    const registry = withClubHooks({ afterWrite });
    await deleteRecord(registry, resourceIn(registry, 'clubs'), 'c1');
    expect(afterWrite).toHaveBeenCalledWith({
      mode: 'delete',
      before: rowLike({ id: 'c1', name: 'Lagos Runners' }),
      after: null,
    });
    expect(tables.club).toEqual([]);
  });

  it('answers 409 when other records still point at the row, and keeps it', async () => {
    const afterWrite = vi.fn<NonNullable<ResourceHooks['afterWrite']>>(() =>
      Promise.resolve()
    );
    const registry = withClubHooks({ afterWrite });
    club.delete.mockRejectedValueOnce(prismaError('P2003'));
    const error = await deleteRecord(
      registry,
      resourceIn(registry, 'clubs'),
      'c1'
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ConflictException);
    expect(error).toMatchObject({
      message: 'Other records still point at this one',
      statusCode: 409,
    });
    expect(tables.club).toHaveLength(1);
    expect(afterWrite).not.toHaveBeenCalled();
  });

  it('answers 403 when the resource forbids it', async () => {
    const registry = resolveRegistry(
      registryWith([
        usersPolicy,
        { ...clubsPolicy, can: { delete: false } },
        membersPolicy,
      ]),
      dm
    );
    await expect(
      deleteRecord(registry, resourceIn(registry, 'clubs'), 'c1')
    ).rejects.toMatchObject({ message: "Clubs can't be deleted here" });
    expect(club.delete).not.toHaveBeenCalled();
  });
});
