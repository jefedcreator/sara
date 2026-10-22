import { whereForKey } from './keys';
import type {
  AdminListQuery,
  AdminRelation,
  AdminResource,
  ResolvedRegistry,
} from './types';

/** The Prisma `findMany` arguments for one page of a list (spec §6.5). */
export type AdminListArgs = {
  where: Record<string, unknown>;
  orderBy: Record<string, 'asc' | 'desc'>[];
  skip: number;
  take: number;
  select: Record<string, unknown>;
};

/** The resource a foreign key points at. */
export function relationTarget(
  registry: ResolvedRegistry,
  relation: AdminRelation
): AdminResource {
  const target = registry.byKey.get(relation.resource);
  if (!target)
    throw new Error(`admin registry: no resource ${relation.resource}`);
  return target;
}

/**
 * The explicit Prisma `select` for a record (spec §6.3): every exposed field,
 * plus each foreign key's target `{ id fields, title field }`. A target whose
 * title is itself a foreign key gives that raw value: one level only.
 */
export function selectFor(
  resource: AdminResource,
  registry: ResolvedRegistry
): Record<string, unknown> {
  const select: Record<string, unknown> = {};
  for (const field of resource.fields) select[field.name] = true;
  for (const relation of resource.relations) {
    const target = relationTarget(registry, relation);
    const refSelect: Record<string, true> = {};
    for (const name of target.idFields) refSelect[name] = true;
    refSelect[target.titleField] = true;
    select[relation.via] = { select: refSelect };
  }
  return select;
}

/**
 * The Prisma `where` for a list (spec §6.5). `query` matches any searchable
 * field, case-insensitively, or the record's id when it's a well-formed one.
 * Each filter is ANDed with it. A blank `query` searches nothing.
 */
export function whereFor(
  resource: AdminResource,
  q: AdminListQuery
): Record<string, unknown> {
  const and: Record<string, unknown>[] = [];

  const text = q.query?.trim() ?? '';
  if (text.length > 0) {
    const or: Record<string, unknown>[] = resource.searchable.map((name) => ({
      [name]: { contains: text, mode: 'insensitive' },
    }));
    // A compound id has no plain `where`, so only a single id can match.
    if (resource.compoundName === null) {
      const id = whereForKey(resource, text);
      if (id !== null) or.push(id);
    }
    and.push({ OR: or });
  }

  for (const name of resource.filterable) {
    const value = q[name];
    if (value !== undefined) and.push({ [name]: value });
  }

  return and.length === 0 ? {} : { AND: and };
}

/**
 * `where`, `orderBy`, paging and `select` for one page of a list. The id
 * fields follow the chosen sort, ascending, so rows that tie on it keep one
 * order and paging never repeats or skips them.
 */
export function listArgs(
  resource: AdminResource,
  q: AdminListQuery,
  registry: ResolvedRegistry
): AdminListArgs {
  const by = q.sortBy ?? resource.defaultSort.by;
  // A column picked without an order sorts ascending, not in the default's.
  const order =
    q.sortOrder ??
    (q.sortBy === undefined ? resource.defaultSort.order : 'asc');
  const orderBy: AdminListArgs['orderBy'] = [{ [by]: order }];
  for (const name of resource.idFields) {
    if (name !== by) orderBy.push({ [name]: 'asc' });
  }
  return {
    where: whereFor(resource, q),
    orderBy,
    skip: (q.page - 1) * q.size,
    take: q.size,
    select: selectFor(resource, registry),
  };
}
