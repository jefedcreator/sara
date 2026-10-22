import { z } from 'zod';
import type { AdminFieldMeta, AdminResource } from './types';

// Every schema here behaves the same under Zod 3.25 and Zod 4.3, because the
// kit is copied byte for byte into Sara, which runs Zod 4:
// - no `.default()` after a transform (Zod 4 skips the transform for it), so
//   list defaults live inside the transform;
// - a required JSON key is checked by the object, not the field (Zod 4 skips
//   a missing key whose schema accepts `undefined`);
// - no `z.record`, no `z.nativeEnum`, and issue codes written as strings.

const DECIMAL = /^-?\d+(\.\d+)?$/;

/**
 * The body a create or update accepts (spec §6.4): a strict object of the
 * writable fields, so a read-only, hidden or unknown key fails by name.
 * Update takes the same fields, all optional, and never an id.
 */
export function writeSchema(
  resource: AdminResource,
  mode: 'create' | 'update'
): z.ZodTypeAny {
  const shape: Record<string, z.ZodTypeAny> = {};
  const requiredJson: string[] = [];
  for (const field of resource.fields) {
    if (field.readOnly || (mode === 'update' && field.isId)) continue;
    shape[field.name] = fieldSchema(field);
    if (field.required && field.type === 'json') requiredJson.push(field.name);
  }

  const body = z.object(shape).strict();
  if (mode === 'update') return body.partial();
  if (requiredJson.length === 0) return body;
  return body.superRefine((value, ctx) => {
    for (const name of requiredJson) {
      if (value[name] === undefined) {
        ctx.addIssue({ code: 'custom', path: [name], message: 'Required' });
      }
    }
  });
}

/**
 * The list parameters (spec §6.5), parsed from query strings. Its output is
 * an `AdminListQuery`: `page` and `size` always set, the rest when given.
 */
export function listQuerySchema(resource: AdminResource): z.ZodTypeAny {
  const shape: Record<string, z.ZodTypeAny> = {
    page: z
      .string()
      .optional()
      .transform((value) => (value === undefined ? 1 : Number(value)))
      .pipe(z.number().int().min(1)),
    size: z
      .string()
      .optional()
      .transform((value) => (value === undefined ? 20 : Number(value)))
      .pipe(z.number().int().min(1).max(100)),
    query: z.string().max(255).optional(),
    sortBy: oneOf(resource.sortable).optional(),
    sortOrder: z.enum(['asc', 'desc']).optional(),
  };
  for (const name of resource.filterable) {
    const field = resource.fields.find((item) => item.name === name);
    shape[name] = filterSchema(field).optional();
  }
  return z.object(shape).strict();
}

/** One field's wire value, with its list, null and optional wrappers. */
function fieldSchema(field: AdminFieldMeta): z.ZodTypeAny {
  let schema = valueSchema(field);
  if (field.list) schema = z.array(schema);
  if (field.nullable) schema = schema.nullable();
  if (!field.required) schema = schema.optional();
  return schema;
}

function valueSchema(field: AdminFieldMeta): z.ZodTypeAny {
  switch (field.type) {
    case 'string':
    case 'text':
      return z.string();
    case 'int':
      return z.number().int();
    case 'float':
      return z.number();
    case 'decimal':
      return z.union([z.number(), z.string().regex(DECIMAL)]);
    case 'boolean':
      return z.boolean();
    case 'datetime':
      return z.string().pipe(z.coerce.date());
    case 'enum':
      return oneOf(field.enumValues ?? []);
    case 'json':
      // Any JSON value. `null` only where the column is nullable; a missing
      // required key is caught by `writeSchema`'s object-level check.
      return field.nullable
        ? z.unknown()
        : z
            .unknown()
            .refine(
              (value) => value !== null,
              'Expected a JSON value, received null'
            );
  }
}

/** A filter's value from the query string: an enum value, a boolean, a key. */
function filterSchema(field: AdminFieldMeta | undefined): z.ZodTypeAny {
  if (field?.type === 'enum') return oneOf(field.enumValues ?? []);
  if (field?.type === 'boolean') {
    return z.enum(['true', 'false']).transform((value) => value === 'true');
  }
  return z.string().min(1);
}

function oneOf(values: string[]): z.ZodTypeAny {
  const [first, ...rest] = values;
  if (first === undefined) return z.never();
  return z.enum([first, ...rest]);
}
