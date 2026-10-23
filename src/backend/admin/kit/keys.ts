import type { AdminResource } from './types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OBJECT_ID = /^[0-9a-f]{24}$/i;
const INTEGER = /^-?\d+$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

/**
 * A record's `_key` (spec §6.3): the id as a string, or for a composite id,
 * base64url of the JSON array of its values in `@@id` order.
 */
export function encodeKey(
  resource: AdminResource,
  row: Record<string, unknown>
): string {
  const values = resource.idFields.map((name) => keyPart(row[name]));
  if (resource.compoundName === null) return String(values[0]);
  return Buffer.from(JSON.stringify(values)).toString('base64url');
}

/**
 * The Prisma `where` for a `_key`, or null when the key can't name a record:
 * it doesn't decode, has the wrong shape, or isn't a well-formed id. Null
 * answers 404, so a malformed key never reaches the database.
 */
export function whereForKey(
  resource: AdminResource,
  key: string
): Record<string, unknown> | null {
  if (resource.compoundName === null) {
    const name = resource.idFields[0];
    if (name === undefined) return null;
    const value = singleId(resource, name, key);
    if (value === null) return null;
    return { [name]: value };
  }

  const parts = decodeParts(key);
  if (parts?.length !== resource.idFields.length) return null;
  const compound: Record<string, unknown> = {};
  for (const [index, name] of resource.idFields.entries()) {
    const value = compositePart(resource, name, parts[index]);
    if (value === null) return null;
    compound[name] = value;
  }
  return { [resource.compoundName]: compound };
}

function keyPart(value: unknown): string | number {
  if (typeof value === 'string' || typeof value === 'number') return value;
  throw new Error('admin key: an id value must be a string or a number');
}

/** A single id from the URL, checked against its kind and native format. */
function singleId(
  resource: AdminResource,
  name: string,
  key: string
): string | number | null {
  if (resource.idKinds[name] === 'int') return toInt(key);
  if (key.length === 0) return null;
  if (resource.idFormat === 'uuid' && !UUID.test(key)) return null;
  if (resource.idFormat === 'objectid' && !OBJECT_ID.test(key)) return null;
  return key;
}

/** One value of a decoded composite key, checked against its kind. */
function compositePart(
  resource: AdminResource,
  name: string,
  value: unknown
): string | number | null {
  if (resource.idKinds[name] === 'int') {
    return typeof value === 'number' && Number.isSafeInteger(value)
      ? value
      : null;
  }
  return typeof value === 'string' ? value : null;
}

function toInt(text: string): number | null {
  if (!INTEGER.test(text)) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : null;
}

function decodeParts(key: string): unknown[] | null {
  if (!BASE64URL.test(key)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(key, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const parts: unknown[] = parsed;
  return parts;
}
