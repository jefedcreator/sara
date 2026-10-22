import type { Datamodel, DmmfField } from '../dmmf';
import {
  type AdminRegistry,
  type ResourcePolicy,
  resolveRegistry,
} from '../policy';
import type { AdminResource, ResolvedRegistry } from '../types';

// A hand-built datamodel holding only the DMMF properties the kit reads, so a
// test fails if the kit starts depending on one it doesn't declare here.

type FixtureField = Pick<
  DmmfField,
  | 'name'
  | 'kind'
  | 'type'
  | 'isList'
  | 'isRequired'
  | 'isId'
  | 'hasDefaultValue'
  | 'isUpdatedAt'
  | 'relationName'
  | 'relationFromFields'
  | 'nativeType'
>;

type FixtureModel = {
  name: string;
  fields: FixtureField[];
  primaryKey: { name: string | null; fields: string[] } | null;
};

type FieldOptions = {
  kind?: 'scalar' | 'enum' | 'object';
  /** `Type?` in the schema */
  optional?: boolean;
  list?: boolean;
  id?: boolean;
  default?: boolean;
  updatedAt?: boolean;
  /** `@db.<native>` */
  native?: string;
  /** A relation field: its name and `fields: [...]` */
  relation?: { name: string; from: string[] };
};

function field(
  name: string,
  type: string,
  options: FieldOptions = {}
): FixtureField {
  return {
    name,
    kind: options.kind ?? 'scalar',
    type,
    isList: options.list ?? false,
    // Prisma reports a scalar or relation list as required.
    isRequired: options.optional !== true,
    isId: options.id ?? false,
    hasDefaultValue: options.default ?? false,
    isUpdatedAt: options.updatedAt ?? false,
    relationName: options.relation?.name,
    relationFromFields: options.relation?.from,
    nativeType: options.native === undefined ? null : [options.native, []],
  };
}

const models: FixtureModel[] = [
  {
    name: 'User',
    primaryKey: null,
    fields: [
      field('id', 'String', { id: true, default: true, native: 'Uuid' }),
      field('email', 'String'),
      field('passwordHash', 'String', { optional: true }),
      field('name', 'String', { optional: true }),
      field('bio', 'String', { optional: true }),
      field('role', 'Role', { kind: 'enum', default: true }),
      field('tags', 'String', { list: true }),
      field('score', 'Decimal', { optional: true }),
      field('payload', 'Json', { optional: true }),
      field('createdAt', 'DateTime', { default: true }),
      field('updatedAt', 'DateTime', { updatedAt: true }),
      field('clubs', 'Club', {
        kind: 'object',
        list: true,
        relation: { name: 'ClubToUser', from: [] },
      }),
    ],
  },
  {
    name: 'Club',
    primaryKey: null,
    fields: [
      field('id', 'String', { id: true, default: true }),
      field('name', 'String'),
      field('ownerId', 'String'),
      field('owner', 'User', {
        kind: 'object',
        relation: { name: 'ClubToUser', from: ['ownerId'] },
      }),
      field('isPublic', 'Boolean', { default: true }),
      field('memberCount', 'Int', { default: true }),
    ],
  },
  {
    name: 'Member',
    primaryKey: { name: null, fields: ['clubId', 'userId'] },
    fields: [
      field('clubId', 'String'),
      field('club', 'Club', {
        kind: 'object',
        relation: { name: 'ClubToMember', from: ['clubId'] },
      }),
      field('userId', 'String'),
      field('user', 'User', {
        kind: 'object',
        relation: { name: 'MemberToUser', from: ['userId'] },
      }),
      field('joinedAt', 'DateTime'),
      field('meta', 'Json'),
    ],
  },
  {
    name: 'Blob',
    primaryKey: null,
    fields: [field('id', 'Int', { id: true }), field('data', 'Bytes')],
  },
];

const enums = [
  { name: 'Role', values: [{ name: 'ADMIN' }, { name: 'MEMBER' }] },
];

// The real DMMF carries more (dbName, uniqueFields, isUnique, …), none of
// which the kit reads, so the partial shape stands in for the whole.
export const dm = { models, enums, types: [] } as unknown as Datamodel;

export const usersPolicy: ResourcePolicy = {
  key: 'users',
  model: 'User',
  group: 'People',
  title: 'email',
};

export const clubsPolicy: ResourcePolicy = {
  key: 'clubs',
  model: 'Club',
  group: 'Clubs',
  title: 'name',
  readOnly: ['memberCount'],
};

export const membersPolicy: ResourcePolicy = {
  key: 'members',
  model: 'Member',
  group: 'Clubs',
  title: 'userId',
};

export const fixtureRegistry: AdminRegistry = {
  product: 'strive',
  resources: [usersPolicy, clubsPolicy, membersPolicy],
  excluded: { Blob: 'test' },
};

/** The fixture registry with these resources in place of its own. */
export function registryWith(resources: ResourcePolicy[]): AdminRegistry {
  return { product: 'strive', resources, excluded: { Blob: 'test' } };
}

/** One resolved resource; throws if the registry doesn't have it. */
export function fixtureResource(
  key: string,
  registry: AdminRegistry = fixtureRegistry
): AdminResource {
  return resourceIn(resolveRegistry(registry, dm), key);
}

/** One resource of an already resolved registry; throws if it isn't there. */
export function resourceIn(
  registry: ResolvedRegistry,
  key: string
): AdminResource {
  const resource = registry.byKey.get(key);
  if (!resource) throw new Error(`fixture has no resource ${key}`);
  return resource;
}
