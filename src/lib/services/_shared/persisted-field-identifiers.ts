/**
 * Transitional boundary for persisted correction/provenance field names.
 *
 * The application vocabulary is already `category`/`subcategories`; the
 * correction and provenance rows remain on their historical identifiers until
 * PR3 migrates those persisted records. Keep the translation here so active
 * callers never need to know the storage vocabulary. Remove this module after
 * PR3 migrates `brand_field_corrections` and `brand_field_events` identifiers.
 */

const PERSISTED_FIELD_ALIASES = {
  category: "product_type",
  subcategories: "product_tags",
} as const;

const APPLICATION_FIELDS_BY_PERSISTED = {
  product_type: "category",
  product_tags: "subcategories",
} as const;

export function toPersistedFieldIdentifier(field: string): string {
  return (
    PERSISTED_FIELD_ALIASES[field as keyof typeof PERSISTED_FIELD_ALIASES] ??
    field
  );
}

export function fromPersistedFieldIdentifier(field: string): string {
  return (
    APPLICATION_FIELDS_BY_PERSISTED[
      field as keyof typeof APPLICATION_FIELDS_BY_PERSISTED
    ] ?? field
  );
}
