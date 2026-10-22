import { encodeKey } from './keys';
import { relationTarget } from './query';
import type {
  AdminRecord,
  AdminRef,
  AdminResource,
  ResolvedRegistry,
} from './types';

/**
 * A row read with `selectFor` as the wire record (spec §6.3): the exposed
 * fields, `_key`, `_title` and one `_refs` entry per foreign key. The nested
 * relation objects the select brought along stay out of it. Dates and
 * decimals are left to the JSON response, which writes them as strings.
 */
export function toAdminRecord(
  resource: AdminResource,
  row: Record<string, unknown>,
  registry: ResolvedRegistry
): AdminRecord {
  const values: Record<string, unknown> = {};
  for (const field of resource.fields) {
    if (field.name in row) values[field.name] = row[field.name];
  }

  const refs: Record<string, AdminRef | null> = {};
  for (const relation of resource.relations) {
    refs[relation.field] = refOf(
      relationTarget(registry, relation),
      row[relation.via]
    );
  }

  const key = encodeKey(resource, row);
  // A foreign key title reads as the record it points at.
  const titleRef = refs[resource.titleField];
  const title = titleRef ? titleRef.title : titleText(row[resource.titleField]);
  return {
    ...values,
    _key: key,
    _title: title === '' ? key : title,
    _refs: refs,
  };
}

/** The record a foreign key points at; null when it points at nothing. */
function refOf(target: AdminResource, related: unknown): AdminRef | null {
  if (!isRow(related)) return null;
  const key = encodeKey(target, related);
  const title = titleText(related[target.titleField]);
  return { key, title: title === '' ? key : title };
}

function titleText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value);
  }
  if (value instanceof Date) return value.toISOString();
  return '';
}

function isRow(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
