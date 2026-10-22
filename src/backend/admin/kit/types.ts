import type { AdminRegistry, ResourceHooks } from './policy';

// ─── The contract (spec §6.2–6.3) ──────────────────────────────────────────────

export type AdminFieldType =
  | 'string'
  | 'text'
  | 'int'
  | 'float'
  | 'decimal'
  | 'boolean'
  | 'datetime'
  | 'enum'
  | 'json';

export interface AdminFieldMeta {
  name: string;
  /** 'emailVerifiedAt' → 'Email verified at' */
  label: string;
  type: AdminFieldType;
  /** A scalar list: String[], Int[] */
  list: boolean;
  /** Must be given on create */
  required: boolean;
  nullable: boolean;
  /** Shown, never accepted */
  readOnly: boolean;
  isId: boolean;
  enumValues: string[] | null;
  /** A foreign key to a registered resource */
  relation: { resource: string } | null;
}

export type AdminCan = { create: boolean; update: boolean; delete: boolean };

export interface AdminResourceMeta {
  /** 'medal-claims' */
  key: string;
  /** 'Medal claims' */
  label: string;
  /** 'Medal claim' */
  singular: string;
  /** 'MedalClaim' */
  model: string;
  group: string;
  /** The field that names a record */
  titleField: string;
  columns: string[];
  searchable: string[];
  sortable: string[];
  filterable: string[];
  defaultSort: { by: string; order: 'asc' | 'desc' };
  can: AdminCan;
  note: string | null;
  /** Rows in the table now */
  count: number;
  /** Exposed fields, in schema order */
  fields: AdminFieldMeta[];
  /** Resources whose `field` points at this one */
  related: { resource: string; field: string }[];
}

export interface AdminManifest {
  product: AdminRegistry['product'];
  /** Registry order */
  resources: AdminResourceMeta[];
}

export type AdminRef = { key: string; title: string };

export type AdminRecord = Record<string, unknown> & {
  /** Opaque: the dashboard never builds one */
  _key: string;
  /** The title field's value; `_key` when that's empty */
  _title: string;
  /** Per foreign key: the record it points at */
  _refs: Record<string, AdminRef | null>;
};

// ─── Requests ──────────────────────────────────────────────────────────────────

export type AdminWriteBody = Record<string, unknown>;

export type AdminListQuery = {
  page: number;
  size: number;
  query?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  [filter: string]: unknown;
};

// ─── Resolved registry ─────────────────────────────────────────────────────────

/** A foreign key scalar, the Prisma relation field, and the target resource key */
export type AdminRelation = { field: string; via: string; resource: string };

export type AdminResource = Omit<AdminResourceMeta, 'count' | 'related'> & {
  /** The Prisma client property: 'medalClaim' */
  delegate: string;
  /** `@id`, or the `@@id` fields in order */
  idFields: string[];
  idKinds: Record<string, 'string' | 'int'>;
  /** The single id's native format; 'any' for a composite id */
  idFormat: 'uuid' | 'objectid' | 'any';
  /** The `@@id` compound name Prisma's `where` takes; null for a single id */
  compoundName: string | null;
  relations: AdminRelation[];
  hooks: ResourceHooks;
};

export type ResolvedRegistry = {
  product: AdminRegistry['product'];
  resources: AdminResource[];
  byKey: Map<string, AdminResource>;
  byModel: Map<string, AdminResource>;
};
