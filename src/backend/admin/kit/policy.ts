import { Prisma } from '../prisma';
import {
  type Datamodel,
  type DmmfField,
  type DmmfModel,
  delegateName,
  enumValues,
  findModel,
  idFieldsOf,
  labelFrom,
} from './dmmf';
import type {
  AdminCan,
  AdminFieldMeta,
  AdminFieldType,
  AdminRelation,
  AdminResource,
  AdminWriteBody,
  ResolvedRegistry,
} from './types';

// ─── Rules ─────────────────────────────────────────────────────────────────────

/** Never exposed, whatever the registry says (spec §7.1). */
export const SECRET_FIELD = /hash|token|secret|password|credential|enc$/i;

/** A string field the dashboard edits as long text (spec §6.2). */
const TEXT_FIELD =
  /(description|body|notes|Md|transcript|message|prompt|caption|reason|bio)$/;

/** Native id formats a case-insensitive `contains` can't search. */
const ID_NATIVE_TYPES = new Set(['Uuid', 'ObjectId']);

/** The list parameters (spec §6.5); a filter can't take one of these names. */
const LIST_PARAMS = new Set(['page', 'size', 'query', 'sortBy', 'sortOrder']);

/** Default columns: the title, then up to this many keys, enums and booleans. */
const DEFAULT_PICKED_COLUMNS = 4;

// ─── Registry types ────────────────────────────────────────────────────────────

export type ResourceHooks = {
  /** Runs on a validated body before it's written; returns the body to write. */
  beforeWrite?: (
    data: AdminWriteBody,
    mode: 'create' | 'update'
  ) => AdminWriteBody;
  /** Runs after a write lands, with the row before and after it. */
  afterWrite?: (change: {
    mode: 'create' | 'update' | 'delete';
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
  }) => Promise<void>;
};

export type ResourcePolicy = {
  /** The URL segment: 'medal-claims' */
  key: string;
  /** The Prisma model: 'MedalClaim' */
  model: string;
  /** The nav group (spec §7.2) */
  group: string;
  /** The field that names a record */
  title: string;
  /** Defaults to the key in sentence case */
  label?: string;
  /** Defaults to the model in sentence case */
  singular?: string;
  /** A sign-in record: read and delete only (spec §7.1) */
  signIn?: true;
  can?: Partial<AdminCan>;
  /** Never exposed, on top of `Bytes` and SECRET_FIELD */
  hidden?: string[];
  /** Shown, never accepted */
  readOnly?: string[];
  /** Expose only these. SECRET_FIELD, `Bytes` and `hidden` still win. */
  expose?: string[];
  columns?: string[];
  searchable?: string[];
  sortable?: string[];
  filterable?: string[];
  defaultSort?: { by: string; order: 'asc' | 'desc' };
  note?: string;
  hooks?: ResourceHooks;
};

export type AdminRegistry = {
  product: '0nbox' | 'strive' | 'parcours' | 'sara' | 'fluid';
  /** In nav order */
  resources: ResourcePolicy[];
  /** Model name → why it isn't a resource */
  excluded: Record<string, string>;
};

// ─── Resolving ─────────────────────────────────────────────────────────────────

function fail(message: string): never {
  throw new Error(`admin registry: ${message}`);
}

/**
 * Checks the registry against the schema and works out everything the admin
 * needs about each resource. Throws `admin registry: …` on any mistake, so a
 * bad registry fails at boot and in its test, never on a request.
 */
export function resolveRegistry(
  registry: AdminRegistry,
  dm: Datamodel = Prisma.dmmf.datamodel
): ResolvedRegistry {
  const keys = new Set<string>();
  const keyByModel = new Map<string, string>();
  for (const policy of registry.resources) {
    if (keys.has(policy.key)) fail(`duplicate key ${policy.key}`);
    keys.add(policy.key);
    if (!findModel(dm, policy.model)) {
      fail(`${policy.key} names unknown model ${policy.model}`);
    }
    if (keyByModel.has(policy.model)) {
      fail(`model ${policy.model} is registered twice`);
    }
    keyByModel.set(policy.model, policy.key);
  }

  const resources = registry.resources.map((policy) =>
    resolveResource(policy, dm, keyByModel)
  );
  const byKey = new Map<string, AdminResource>();
  const byModel = new Map<string, AdminResource>();
  for (const resource of resources) {
    byKey.set(resource.key, resource);
    byModel.set(resource.model, resource);
  }
  return { product: registry.product, resources, byKey, byModel };
}

/** Models that are neither a resource nor excluded, in schema order. */
export function uncoveredModels(
  registry: AdminRegistry,
  dm: Datamodel = Prisma.dmmf.datamodel
): string[] {
  const covered = new Set(registry.resources.map((policy) => policy.model));
  for (const name of Object.keys(registry.excluded)) covered.add(name);
  return dm.models
    .map((model) => model.name)
    .filter((name) => !covered.has(name));
}

function resolveResource(
  policy: ResourcePolicy,
  dm: Datamodel,
  keyByModel: Map<string, string>
): AdminResource {
  const model = findModel(dm, policy.model);
  if (!model) return fail(`${policy.key} names unknown model ${policy.model}`);
  const key = policy.key;

  const modelFields = new Set(model.fields.map((field) => field.name));
  requireModelFields(key, 'hidden', policy.hidden, modelFields);
  requireModelFields(key, 'readOnly', policy.readOnly, modelFields);
  requireModelFields(key, 'expose', policy.expose, modelFields);

  const idFields = idFieldsOf(model);
  const firstId = idFields[0];
  if (firstId === undefined) fail(`${key}: ${policy.model} has no @id or @@id`);

  // Each foreign key scalar whose relation targets a registered model.
  const targets = new Map<string, { via: string; resource: string }>();
  for (const field of model.fields) {
    const from = field.relationFromFields?.[0];
    if (field.kind !== 'object' || from === undefined) continue;
    const resource = keyByModel.get(field.type);
    if (resource !== undefined)
      targets.set(from, { via: field.name, resource });
  }

  const hidden = new Set(policy.hidden ?? []);
  const readOnly = new Set(policy.readOnly ?? []);
  const expose = policy.expose ? new Set(policy.expose) : null;
  const fields: AdminFieldMeta[] = [];
  const searchCapable = new Set<string>();
  for (const field of model.fields) {
    const type = fieldType(field);
    if (type === null || !isExposed(field, hidden, expose)) continue;
    const target = targets.get(field.name);
    const meta = fieldMeta(field, type, {
      dm,
      isId: idFields.includes(field.name),
      readOnly: readOnly.has(field.name),
      relation: target ? { resource: target.resource } : null,
    });
    fields.push(meta);
    if (isSearchCapable(field, meta)) searchCapable.add(meta.name);
  }

  const exposed = new Map<string, AdminFieldMeta>();
  for (const field of fields) exposed.set(field.name, field);
  for (const name of idFields) {
    if (!exposed.has(name)) fail(`${key}: id field ${name} must be exposed`);
  }
  if (!exposed.has(policy.title)) {
    fail(`${key}: title ${policy.title} isn't an exposed field`);
  }

  const relations: AdminRelation[] = [];
  for (const [field, target] of targets) {
    if (!exposed.has(field)) continue;
    relations.push({ field, via: target.via, resource: target.resource });
  }

  const columns = policy.columns ?? defaultColumns(policy.title, fields);
  for (const name of columns) {
    if (!exposed.has(name))
      fail(`${key}: column ${name} isn't an exposed field`);
  }

  const searchable =
    policy.searchable ??
    unique([policy.title, 'email', 'name', 'slug', 'title']).filter((name) =>
      searchCapable.has(name)
    );
  for (const name of searchable) {
    if (!searchCapable.has(name)) {
      fail(`${key}: searchable ${name} isn't an exposed string field`);
    }
  }

  const sortable =
    policy.sortable ??
    fields.filter((field) => canSort(field)).map((field) => field.name);
  for (const name of sortable) {
    const field = exposed.get(name);
    if (!field || !canSort(field)) {
      fail(`${key}: sortable ${name} isn't an exposed field that sorts`);
    }
  }

  const filterable =
    policy.filterable ??
    fields
      .filter((field) => canFilter(field) && !LIST_PARAMS.has(field.name))
      .map((field) => field.name);
  for (const name of filterable) {
    const field = exposed.get(name);
    if (LIST_PARAMS.has(name)) {
      fail(`${key}: filterable ${name} clashes with a list parameter`);
    }
    if (!field || !canFilter(field)) {
      fail(
        `${key}: filterable ${name} isn't an exposed enum, boolean or foreign key`
      );
    }
  }

  const createdAt = exposed.get('createdAt');
  let defaultSort: AdminResource['defaultSort'] =
    createdAt && canSort(createdAt)
      ? { by: 'createdAt', order: 'desc' }
      : { by: firstId, order: 'asc' };
  if (policy.defaultSort) {
    if (!sortable.includes(policy.defaultSort.by)) {
      fail(`${key}: defaultSort ${policy.defaultSort.by} isn't sortable`);
    }
    defaultSort = policy.defaultSort;
  }

  const idKinds: AdminResource['idKinds'] = {};
  for (const name of idFields) {
    const field = model.fields.find((item) => item.name === name);
    idKinds[name] = field?.type === 'Int' ? 'int' : 'string';
  }

  return {
    key,
    label: policy.label ?? labelFrom(key),
    singular: policy.singular ?? labelFrom(policy.model),
    model: policy.model,
    group: policy.group,
    titleField: policy.title,
    columns,
    searchable,
    sortable,
    filterable,
    defaultSort,
    can: resolveCan(policy),
    note: policy.note ?? null,
    fields,
    delegate: delegateName(policy.model),
    idFields,
    idKinds,
    idFormat: idFormatOf(model, idFields),
    compoundName:
      idFields.length > 1
        ? (model.primaryKey?.name ?? idFields.join('_'))
        : null,
    relations,
    hooks: policy.hooks ?? {},
  };
}

// ─── Fields ────────────────────────────────────────────────────────────────────

/** The admin type for a Prisma field; null for one the admin never shows. */
function fieldType(field: DmmfField): AdminFieldType | null {
  if (field.kind === 'enum') return 'enum';
  if (field.kind !== 'scalar') return null;
  switch (field.type) {
    case 'String':
      return TEXT_FIELD.test(field.name) ? 'text' : 'string';
    case 'Int':
      return 'int';
    case 'Float':
      return 'float';
    case 'Decimal':
      return 'decimal';
    case 'Boolean':
      return 'boolean';
    case 'DateTime':
      return 'datetime';
    case 'Json':
      return 'json';
    default:
      // Bytes, BigInt and anything else the admin has no wire type for.
      return null;
  }
}

function isExposed(
  field: DmmfField,
  hidden: Set<string>,
  expose: Set<string> | null
): boolean {
  if (field.type === 'Bytes') return false;
  if (SECRET_FIELD.test(field.name)) return false;
  if (hidden.has(field.name)) return false;
  return expose === null || expose.has(field.name);
}

function fieldMeta(
  field: DmmfField,
  type: AdminFieldType,
  context: {
    dm: Datamodel;
    isId: boolean;
    readOnly: boolean;
    relation: AdminFieldMeta['relation'];
  }
): AdminFieldMeta {
  const readOnly =
    (context.isId && field.hasDefaultValue) ||
    field.name === 'createdAt' ||
    field.isUpdatedAt === true ||
    context.readOnly;
  return {
    name: field.name,
    label: labelFrom(field.name),
    type,
    list: field.isList,
    // `@updatedAt` is read-only, so it's covered by `!readOnly`. A scalar list
    // is never required: Prisma creates it empty.
    required:
      field.isRequired && !field.isList && !field.hasDefaultValue && !readOnly,
    nullable: !field.isRequired && !field.isList,
    readOnly,
    isId: context.isId,
    enumValues: type === 'enum' ? enumValues(context.dm, field.type) : null,
    relation: context.relation,
  };
}

/** A plain string a case-insensitive `contains` can run on. */
function isSearchCapable(field: DmmfField, meta: AdminFieldMeta): boolean {
  if (meta.type !== 'string' && meta.type !== 'text') return false;
  if (meta.list || meta.relation !== null) return false;
  return !ID_NATIVE_TYPES.has(field.nativeType?.[0] ?? '');
}

function canSort(field: AdminFieldMeta): boolean {
  return !field.list && field.type !== 'json';
}

function canFilter(field: AdminFieldMeta): boolean {
  if (field.list) return false;
  return (
    field.type === 'enum' || field.type === 'boolean' || field.relation !== null
  );
}

// ─── Resource defaults ─────────────────────────────────────────────────────────

/** The title, then up to four keys, enums and booleans, then `createdAt`. */
function defaultColumns(title: string, fields: AdminFieldMeta[]): string[] {
  const columns = [title];
  let picked = 0;
  for (const field of fields) {
    if (picked === DEFAULT_PICKED_COLUMNS) break;
    if (field.name === title || !canFilter(field)) continue;
    columns.push(field.name);
    picked += 1;
  }
  const hasCreatedAt = fields.some((field) => field.name === 'createdAt');
  if (hasCreatedAt && !columns.includes('createdAt')) columns.push('createdAt');
  return columns;
}

function resolveCan(policy: ResourcePolicy): AdminCan {
  const signIn = policy.signIn === true;
  const can: AdminCan = { create: !signIn, update: !signIn, delete: true };
  if (policy.can?.create !== undefined) can.create = policy.can.create;
  if (policy.can?.update !== undefined) can.update = policy.can.update;
  if (policy.can?.delete !== undefined) can.delete = policy.can.delete;
  return can;
}

function idFormatOf(
  model: DmmfModel,
  idFields: string[]
): AdminResource['idFormat'] {
  if (idFields.length !== 1) return 'any';
  const field = model.fields.find((item) => item.name === idFields[0]);
  const native = field?.nativeType?.[0];
  if (native === 'Uuid') return 'uuid';
  if (native === 'ObjectId') return 'objectid';
  return 'any';
}

function requireModelFields(
  key: string,
  option: 'hidden' | 'readOnly' | 'expose',
  names: string[] | undefined,
  modelFields: Set<string>
): void {
  for (const name of names ?? []) {
    if (!modelFields.has(name))
      fail(`${key}: ${option} names no field ${name}`);
  }
}

function unique(names: string[]): string[] {
  return [...new Set(names)];
}
