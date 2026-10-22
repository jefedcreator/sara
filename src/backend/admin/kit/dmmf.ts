import type { Prisma } from '../prisma';

/**
 * The schema as the generated client carries it at runtime. Typed from
 * `Prisma.dmmf.datamodel` itself rather than `Prisma.DMMF.Datamodel`, which
 * also requires `indexes`, so the runtime value is a valid default.
 */
export type Datamodel = typeof Prisma.dmmf.datamodel;
export type DmmfModel = Prisma.DMMF.Model;
export type DmmfField = Prisma.DMMF.Field;

export function findModel(
  dm: Datamodel,
  name: string
): Prisma.DMMF.Model | undefined {
  return dm.models.find((model) => model.name === name);
}

/** An enum's values in schema order; empty for an unknown enum. */
export function enumValues(dm: Datamodel, name: string): string[] {
  const found = dm.enums.find((item) => item.name === name);
  if (!found) return [];
  return found.values.map((value) => value.name);
}

/** `@@id` fields in order when the model has one, otherwise its `@id` field. */
export function idFieldsOf(model: Prisma.DMMF.Model): string[] {
  const compound = model.primaryKey?.fields ?? [];
  if (compound.length > 0) return [...compound];
  const id = model.fields.find((field) => field.isId);
  return id ? [id.name] : [];
}

/** The Prisma client property for a model: 'MedalClaim' → 'medalClaim'. */
export function delegateName(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

/**
 * Sentence case from a field, model or key name: 'emailVerifiedAt' →
 * 'Email verified at', 'access_token' → 'Access token', 'medal-claims' →
 * 'Medal claims', 'MedalClaim' → 'Medal claim'. Acronyms keep their case.
 */
export function labelFrom(name: string): string {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .split(/[\s_-]+/)
    .filter((word) => word.length > 0)
    .map((word) => (/^[A-Z][A-Z0-9]+$/.test(word) ? word : word.toLowerCase()));
  const text = words.join(' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}
