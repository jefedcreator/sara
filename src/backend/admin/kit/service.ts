import { db } from '@/server/db';
import { UnprocessableEntityException } from '@/utils/exceptions';
import { jsonNull } from '../prisma';
import { forbidden, notFound, prismaCode, toHttpException } from './errors';
import { whereForKey } from './keys';
import { manifestFor } from './manifest';
import { listArgs, relationTarget, selectFor } from './query';
import { toAdminRecord } from './records';
import type {
  AdminListQuery,
  AdminManifest,
  AdminRecord,
  AdminResource,
  AdminWriteBody,
  ResolvedRegistry,
} from './types';

type Row = Record<string, unknown>;
type Args = Record<string, unknown>;

/** The six Prisma delegate methods the admin calls, whatever the model. */
type AdminDelegate = {
  findMany: (args: Args) => Promise<Row[]>;
  findUnique: (args: Args) => Promise<Row | null>;
  count: (args: Args) => Promise<number>;
  create: (args: Args) => Promise<Row>;
  update: (args: Args) => Promise<Row>;
  delete: (args: Args) => Promise<Row>;
};

// ─── Reads ─────────────────────────────────────────────────────────────────────

/** The manifest, with each resource's row count. */
export async function readManifest(
  registry: ResolvedRegistry
): Promise<AdminManifest> {
  const counts: Record<string, number> = {};
  await Promise.all(
    registry.resources.map(async (resource) => {
      counts[resource.key] = await delegateFor(resource).count({});
    })
  );
  return manifestFor(registry, counts);
}

/** One page of records and the total that match. */
export async function listRecords(
  registry: ResolvedRegistry,
  resource: AdminResource,
  q: AdminListQuery
): Promise<{ data: AdminRecord[]; total: number }> {
  const args = listArgs(resource, q, registry);
  const delegate = delegateFor(resource);
  const [rows, total] = await attempt(resource, () =>
    Promise.all([
      delegate.findMany(args),
      delegate.count({ where: args.where }),
    ])
  );
  return {
    data: rows.map((row) => toAdminRecord(resource, row, registry)),
    total,
  };
}

/** One record by its `_key`; 404 for a bad key or a missing record. */
export async function readRecord(
  registry: ResolvedRegistry,
  resource: AdminResource,
  key: string
): Promise<AdminRecord> {
  const { row } = await existingRow(registry, resource, key);
  return toAdminRecord(resource, row, registry);
}

// ─── Writes ────────────────────────────────────────────────────────────────────
// Every write: check `can`, check each foreign key, run `beforeWrite`, store
// JSON null as the product's `jsonNull`, write with an explicit select, run
// `afterWrite`.

export async function createRecord(
  registry: ResolvedRegistry,
  resource: AdminResource,
  body: AdminWriteBody
): Promise<AdminRecord> {
  if (!resource.can.create) throw forbidden(resource, 'create');
  await checkReferences(registry, resource, body);
  const data = prepare(resource, body, 'create');
  const after = await attempt(resource, () =>
    delegateFor(resource).create({
      data,
      select: selectFor(resource, registry),
    })
  );
  await resource.hooks.afterWrite?.({ mode: 'create', before: null, after });
  return toAdminRecord(resource, after, registry);
}

export async function updateRecord(
  registry: ResolvedRegistry,
  resource: AdminResource,
  key: string,
  body: AdminWriteBody
): Promise<AdminRecord> {
  if (!resource.can.update) throw forbidden(resource, 'update');
  const { where, row: before } = await existingRow(registry, resource, key);
  await checkReferences(registry, resource, body);
  const data = prepare(resource, body, 'update');
  const after = await attempt(resource, () =>
    delegateFor(resource).update({
      where,
      data,
      select: selectFor(resource, registry),
    })
  );
  await resource.hooks.afterWrite?.({ mode: 'update', before, after });
  return toAdminRecord(resource, after, registry);
}

export async function deleteRecord(
  registry: ResolvedRegistry,
  resource: AdminResource,
  key: string
): Promise<void> {
  if (!resource.can.delete) throw forbidden(resource, 'delete');
  const { where, row: before } = await existingRow(registry, resource, key);
  await attempt(resource, () =>
    delegateFor(resource).delete({ where, select: idSelect(resource) })
  );
  await resource.hooks.afterWrite?.({ mode: 'delete', before, after: null });
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function delegateFor(resource: AdminResource): AdminDelegate {
  const delegate = (db as unknown as Record<string, AdminDelegate>)[
    resource.delegate
  ];
  if (!delegate)
    throw new Error(`admin: no Prisma delegate ${resource.delegate}`);
  return delegate;
}

/** Runs a Prisma call, turning its errors into the spec §6.6 statuses. */
async function attempt<T>(
  resource: AdminResource,
  work: () => Promise<T>
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw toHttpException(error, resource);
  }
}

/** The row a `_key` names, read with the record's select, and its `where`. */
async function existingRow(
  registry: ResolvedRegistry,
  resource: AdminResource,
  key: string
): Promise<{ where: Args; row: Row }> {
  const where = whereForKey(resource, key);
  if (where === null) throw notFound(resource);
  const row = await attempt(resource, () =>
    delegateFor(resource).findUnique({
      where,
      select: selectFor(resource, registry),
    })
  );
  if (row === null) throw notFound(resource);
  return { where, row };
}

/**
 * 422 `<field>: no such <target>` when a foreign key in the body names no
 * record (spec §6.4). MongoDB won't check this for us, so every product does.
 */
async function checkReferences(
  registry: ResolvedRegistry,
  resource: AdminResource,
  body: AdminWriteBody
): Promise<void> {
  for (const relation of resource.relations) {
    const value = body[relation.field];
    if (value === undefined || value === null) continue;
    const target = relationTarget(registry, relation);
    if (!(await recordExists(target, value))) {
      throw new UnprocessableEntityException(
        `${relation.field}: no such ${target.singular.toLowerCase()}`
      );
    }
  }
}

/** Whether a foreign key value names a record; a malformed one names none. */
async function recordExists(
  target: AdminResource,
  value: unknown
): Promise<boolean> {
  if (typeof value !== 'string' && typeof value !== 'number') return false;
  const where = whereForKey(target, String(value));
  if (where === null) return false;
  try {
    const row = await delegateFor(target).findUnique({
      where,
      select: idSelect(target),
    });
    return row !== null;
  } catch (error) {
    if (prismaCode(error) === 'P2023') return false;
    throw error;
  }
}

/**
 * Runs `beforeWrite`, then stores JSON `null` as the product's `jsonNull`
 * (spec §6.4): `Prisma.DbNull` on PostgreSQL, a plain null on MongoDB.
 */
function prepare(
  resource: AdminResource,
  body: AdminWriteBody,
  mode: 'create' | 'update'
): Row {
  const hooked = resource.hooks.beforeWrite?.(body, mode) ?? body;
  const data: Row = {};
  for (const [name, value] of Object.entries(hooked)) {
    data[name] =
      value === null && isNullableJson(resource, name) ? jsonNull : value;
  }
  return data;
}

function isNullableJson(resource: AdminResource, name: string): boolean {
  return resource.fields.some(
    (field) => field.name === name && field.type === 'json' && field.nullable
  );
}

function idSelect(resource: AdminResource): Record<string, true> {
  const select: Record<string, true> = {};
  for (const name of resource.idFields) select[name] = true;
  return select;
}
