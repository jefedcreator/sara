import type {
  AdminManifest,
  AdminResource,
  AdminResourceMeta,
  ResolvedRegistry,
} from './types';

/**
 * The manifest (spec §6.2): every resource in registry order, with its row
 * count and the resources that point at it. Built field by field, so the
 * resolved registry's internals (delegate, ids, hooks) never reach the wire.
 */
export function manifestFor(
  registry: ResolvedRegistry,
  counts: Record<string, number>
): AdminManifest {
  return {
    product: registry.product,
    resources: registry.resources.map((resource) =>
      resourceMeta(registry, resource, counts[resource.key] ?? 0)
    ),
  };
}

function resourceMeta(
  registry: ResolvedRegistry,
  resource: AdminResource,
  count: number
): AdminResourceMeta {
  return {
    key: resource.key,
    label: resource.label,
    singular: resource.singular,
    model: resource.model,
    group: resource.group,
    titleField: resource.titleField,
    columns: resource.columns,
    searchable: resource.searchable,
    sortable: resource.sortable,
    filterable: resource.filterable,
    defaultSort: resource.defaultSort,
    can: resource.can,
    note: resource.note,
    count,
    fields: resource.fields,
    related: relatedTo(registry, resource.key),
  };
}

/** Each resource field that points at `key`, in registry order. */
function relatedTo(
  registry: ResolvedRegistry,
  key: string
): AdminResourceMeta['related'] {
  const related: AdminResourceMeta['related'] = [];
  for (const other of registry.resources) {
    for (const relation of other.relations) {
      if (relation.resource === key) {
        related.push({ resource: other.key, field: relation.field });
      }
    }
  }
  return related;
}
