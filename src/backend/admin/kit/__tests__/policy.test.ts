import { describe, expect, it } from 'vitest';
import { labelFrom } from '../dmmf';
import {
  type AdminRegistry,
  resolveRegistry,
  uncoveredModels,
} from '../policy';
import type { AdminFieldMeta, AdminResource } from '../types';
import {
  clubsPolicy,
  dm,
  fixtureRegistry,
  fixtureResource,
  membersPolicy,
  registryWith,
  usersPolicy,
} from './fixture';

function fieldOf(resource: AdminResource, name: string): AdminFieldMeta {
  const found = resource.fields.find((field) => field.name === name);
  if (!found) throw new Error(`${resource.key} has no field ${name}`);
  return found;
}

describe('resolveRegistry: exposure', () => {
  it('drops secret fields and relation fields', () => {
    const users = fixtureResource('users');
    expect(users.fields.map((field) => field.name)).toEqual([
      'id',
      'email',
      'name',
      'bio',
      'role',
      'tags',
      'score',
      'payload',
      'createdAt',
      'updatedAt',
    ]);
  });

  it('lets the secret pattern beat expose', () => {
    const registry = registryWith([
      { ...usersPolicy, expose: ['id', 'passwordHash', 'email'] },
      clubsPolicy,
      membersPolicy,
    ]);
    const users = fixtureResource('users', registry);
    expect(users.fields.map((field) => field.name)).toEqual(['id', 'email']);
  });

  it('drops hidden fields', () => {
    const registry = registryWith([
      { ...usersPolicy, hidden: ['bio'] },
      clubsPolicy,
      membersPolicy,
    ]);
    const users = fixtureResource('users', registry);
    expect(users.fields.map((field) => field.name)).not.toContain('bio');
  });

  it('never exposes Bytes', () => {
    const registry = registryWith([
      usersPolicy,
      clubsPolicy,
      membersPolicy,
      { key: 'blobs', model: 'Blob', group: 'Files', title: 'id' },
    ]);
    const blobs = fixtureResource('blobs', registry);
    expect(blobs.fields.map((field) => field.name)).toEqual(['id']);
  });
});

describe('resolveRegistry: field metadata', () => {
  const users = fixtureResource('users');

  it('makes an id with a default read-only', () => {
    expect(fieldOf(users, 'id')).toMatchObject({ readOnly: true, isId: true });
  });

  it('makes createdAt and @updatedAt read-only', () => {
    expect(fieldOf(users, 'createdAt').readOnly).toBe(true);
    expect(fieldOf(users, 'updatedAt').readOnly).toBe(true);
  });

  it('maps Prisma types', () => {
    expect(fieldOf(users, 'email')).toMatchObject({
      required: true,
      type: 'string',
      label: 'Email',
    });
    expect(fieldOf(users, 'bio')).toMatchObject({
      type: 'text',
      nullable: true,
      required: false,
    });
    expect(fieldOf(users, 'role')).toMatchObject({
      type: 'enum',
      enumValues: ['ADMIN', 'MEMBER'],
      required: false,
    });
    expect(fieldOf(users, 'tags')).toMatchObject({
      list: true,
      required: false,
      nullable: false,
    });
    expect(fieldOf(users, 'score').type).toBe('decimal');
    expect(fieldOf(users, 'payload').type).toBe('json');
    expect(fieldOf(users, 'createdAt')).toMatchObject({
      type: 'datetime',
      label: 'Created at',
    });
  });

  it('resolves foreign keys to registered resources', () => {
    const clubs = fixtureResource('clubs');
    expect(fieldOf(clubs, 'ownerId').relation).toEqual({ resource: 'users' });
    expect(clubs.relations).toEqual([
      { field: 'ownerId', via: 'owner', resource: 'users' },
    ]);
    expect(fieldOf(clubs, 'memberCount').readOnly).toBe(true);
    expect(fieldOf(clubs, 'isPublic').type).toBe('boolean');
    expect(fieldOf(clubs, 'memberCount').type).toBe('int');
  });

  it('keeps a foreign key to an unregistered model as a plain string', () => {
    const clubs = fixtureResource('clubs', registryWith([clubsPolicy]));
    expect(fieldOf(clubs, 'ownerId')).toMatchObject({
      type: 'string',
      relation: null,
    });
    expect(clubs.relations).toEqual([]);
  });

  it('describes ids', () => {
    const members = fixtureResource('members');
    expect(members.idFields).toEqual(['clubId', 'userId']);
    expect(members.compoundName).toBe('clubId_userId');
    expect(members.idFormat).toBe('any');
    expect(members.idKinds).toEqual({ clubId: 'string', userId: 'string' });
    expect(fieldOf(members, 'clubId')).toMatchObject({
      isId: true,
      readOnly: false,
      required: true,
    });
    expect(users.idFields).toEqual(['id']);
    expect(users.compoundName).toBeNull();
    expect(users.idFormat).toBe('uuid');
    expect(fixtureResource('clubs').idFormat).toBe('any');
  });

  it('names the resource', () => {
    const members = fixtureResource('members');
    expect(members).toMatchObject({
      label: 'Members',
      singular: 'Member',
      delegate: 'member',
      titleField: 'userId',
      group: 'Clubs',
      note: null,
    });
  });
});

describe('resolveRegistry: defaults', () => {
  const users = fixtureResource('users');
  const members = fixtureResource('members');

  it('picks columns', () => {
    expect(users.columns[0]).toBe('email');
    expect(users.columns).toEqual(['email', 'role', 'createdAt']);
    expect(members.columns).toEqual(['userId', 'clubId']);
  });

  it('searches the title and the usual name fields', () => {
    expect(users.searchable).toEqual(['email', 'name']);
    expect(members.searchable).toEqual([]);
  });

  it('sorts by every scalar but lists and JSON', () => {
    expect(users.sortable).not.toContain('tags');
    expect(users.sortable).not.toContain('payload');
    expect(users.sortable).toContain('email');
  });

  it('filters by enums, booleans and foreign keys', () => {
    expect(users.filterable).toEqual(['role']);
    expect(fixtureResource('clubs').filterable).toEqual([
      'ownerId',
      'isPublic',
    ]);
  });

  it('sorts by createdAt, else the first id', () => {
    expect(users.defaultSort).toEqual({ by: 'createdAt', order: 'desc' });
    expect(members.defaultSort).toEqual({ by: 'clubId', order: 'asc' });
  });

  it('allows everything unless the resource is a sign-in record', () => {
    expect(users.can).toEqual({ create: true, update: true, delete: true });
    const registry = registryWith([
      { ...usersPolicy, signIn: true },
      clubsPolicy,
      membersPolicy,
    ]);
    expect(fixtureResource('users', registry).can).toEqual({
      create: false,
      update: false,
      delete: true,
    });
  });

  it('takes overrides from the registry', () => {
    const registry = registryWith([
      {
        ...usersPolicy,
        label: 'People',
        singular: 'Person',
        columns: ['email', 'name'],
        searchable: ['email'],
        sortable: ['email', 'createdAt'],
        filterable: [],
        defaultSort: { by: 'email', order: 'asc' },
        can: { delete: false },
        note: 'Handle with care.',
      },
      clubsPolicy,
      membersPolicy,
    ]);
    expect(fixtureResource('users', registry)).toMatchObject({
      label: 'People',
      singular: 'Person',
      columns: ['email', 'name'],
      searchable: ['email'],
      sortable: ['email', 'createdAt'],
      filterable: [],
      defaultSort: { by: 'email', order: 'asc' },
      can: { create: true, update: true, delete: false },
      note: 'Handle with care.',
    });
  });
});

describe('labelFrom', () => {
  it('turns names into sentence case', () => {
    expect(labelFrom('emailVerifiedAt')).toBe('Email verified at');
    expect(labelFrom('access_token')).toBe('Access token');
    expect(labelFrom('medal-claims')).toBe('Medal claims');
    expect(labelFrom('MedalClaim')).toBe('Medal claim');
  });
});

describe('resolveRegistry: mistakes', () => {
  const broken: Record<string, AdminRegistry> = {
    'an unknown model': registryWith([
      usersPolicy,
      { key: 'ghosts', model: 'Ghost', group: 'People', title: 'id' },
    ]),
    'a duplicate key': registryWith([
      usersPolicy,
      { key: 'users', model: 'Blob', group: 'People', title: 'id' },
    ]),
    'a model registered twice': registryWith([
      usersPolicy,
      { key: 'people', model: 'User', group: 'People', title: 'email' },
    ]),
    'a title that is not exposed': registryWith([
      { ...usersPolicy, title: 'passwordHash' },
    ]),
    'a column that is not exposed': registryWith([
      { ...usersPolicy, columns: ['email', 'passwordHash'] },
    ]),
    'a searchable field that is not exposed': registryWith([
      { ...usersPolicy, searchable: ['passwordHash'] },
    ]),
    'a sortable field that is not exposed': registryWith([
      { ...usersPolicy, sortable: ['passwordHash'] },
    ]),
    'a filterable field that is not exposed': registryWith([
      { ...usersPolicy, filterable: ['passwordHash'] },
    ]),
    'a searchable field that is not a string': registryWith([
      { ...usersPolicy, searchable: ['role'] },
    ]),
    'a sortable list': registryWith([{ ...usersPolicy, sortable: ['tags'] }]),
    'a filterable plain string': registryWith([
      { ...usersPolicy, filterable: ['email'] },
    ]),
    'a default sort that is not sortable': registryWith([
      { ...usersPolicy, defaultSort: { by: 'payload', order: 'asc' } },
    ]),
    'a hidden name that is not a field': registryWith([
      { ...usersPolicy, hidden: ['nrcAuthMeta'] },
    ]),
    'a hidden id': registryWith([{ ...usersPolicy, hidden: ['id'] }]),
  };

  for (const [mistake, registry] of Object.entries(broken)) {
    it(`throws for ${mistake}`, () => {
      expect(() => resolveRegistry(registry, dm)).toThrow(/admin registry/);
    });
  }
});

describe('uncoveredModels', () => {
  it('lists models that are neither registered nor excluded', () => {
    expect(uncoveredModels(fixtureRegistry, dm)).toEqual([]);
    expect(uncoveredModels({ ...fixtureRegistry, excluded: {} }, dm)).toEqual([
      'Blob',
    ]);
  });
});
