import { describe, expect, it } from 'vitest';
import { manifestFor } from '../manifest';
import { SECRET_FIELD, resolveRegistry } from '../policy';
import type { AdminResourceMeta } from '../types';
import { dm, fixtureRegistry } from './fixture';

const resolved = resolveRegistry(fixtureRegistry, dm);
const manifest = manifestFor(resolved, { users: 2, clubs: 1, members: 0 });

function metaOf(key: string): AdminResourceMeta {
  const found = manifest.resources.find((resource) => resource.key === key);
  if (!found) throw new Error(`manifest has no resource ${key}`);
  return found;
}

describe('manifestFor', () => {
  it('lists the resources in registry order with their counts', () => {
    expect(manifest.product).toBe('strive');
    expect(manifest.resources.map((resource) => resource.key)).toEqual([
      'users',
      'clubs',
      'members',
    ]);
    expect(metaOf('users').count).toBe(2);
    expect(metaOf('clubs').count).toBe(1);
    expect(metaOf('members').count).toBe(0);
    expect(metaOf('users').note).toBeNull();
  });

  it('counts a resource with no count as empty', () => {
    expect(manifestFor(resolved, {}).resources[0]?.count).toBe(0);
  });

  it('lists the resources that point at each one', () => {
    expect(metaOf('users').related).toEqual([
      { resource: 'clubs', field: 'ownerId' },
      { resource: 'members', field: 'userId' },
    ]);
    expect(metaOf('clubs').related).toEqual([
      { resource: 'members', field: 'clubId' },
    ]);
    expect(metaOf('members').related).toEqual([]);
  });

  it('exposes no secret field', () => {
    const names = manifest.resources.flatMap((resource) =>
      resource.fields.map((field) => field.name)
    );
    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((name) => SECRET_FIELD.test(name))).toEqual([]);
  });

  it('keeps the resolved internals off the wire', () => {
    const users = metaOf('users');
    for (const internal of [
      'delegate',
      'idFields',
      'idKinds',
      'idFormat',
      'compoundName',
      'relations',
      'hooks',
    ]) {
      expect(users).not.toHaveProperty(internal);
    }
    expect(users).toMatchObject({
      key: 'users',
      label: 'Users',
      singular: 'User',
      model: 'User',
      group: 'People',
      titleField: 'email',
      can: { create: true, update: true, delete: true },
    });
  });
});
