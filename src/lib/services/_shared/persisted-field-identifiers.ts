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
  subcategories_en: "product_tags_en",
} as const;

const APPLICATION_FIELDS_BY_PERSISTED = {
  product_type: "category",
  product_tags: "subcategories",
  product_tags_en: "subcategories_en",
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

/**
 * A zh/en subcategory pair is synchronized at the column boundary. A lock on
 * either historical array must therefore protect both application fields;
 * otherwise a derived English patch could trigger the compatibility trigger
 * and change the owner's locked Chinese value indirectly.
 */
export function fromPersistedFieldIdentifiers(field: string): string[] {
  if (field === "product_tags" || field === "product_tags_en") {
    return ["subcategories", "subcategories_en"];
  }
  return [fromPersistedFieldIdentifier(field)];
}

export type PersistedFieldStateRow = {
  field: string;
  source: string;
  updated_at?: string | null;
};

export type ApplicationFieldState = {
  source: string;
  updatedAt?: string;
};

const FIELD_STATE_SOURCE_PRIORITY: Record<string, number> = {
  enriched: 1,
  submitted: 2,
  admin: 3,
  owner: 4,
};

function sourcePriority(source: string): number {
  return FIELD_STATE_SOURCE_PRIORITY[source] ?? 0;
}

function shouldReplaceFieldState(
  candidate: ApplicationFieldState,
  candidatePersistedField: string,
  current: ApplicationFieldState,
  currentPersistedField: string,
): boolean {
  const candidatePriority = sourcePriority(candidate.source);
  const currentPriority = sourcePriority(current.source);
  if (candidatePriority !== currentPriority) {
    return candidatePriority > currentPriority;
  }

  const candidateUpdatedAt = candidate.updatedAt ?? "";
  const currentUpdatedAt = current.updatedAt ?? "";
  if (candidateUpdatedAt !== currentUpdatedAt) {
    return candidateUpdatedAt > currentUpdatedAt;
  }

  // The database normally has one row per field. This final tie-breaker only
  // applies to the synchronized zh/en pair and keeps the result row-order
  // independent even when timestamps collide.
  return candidatePersistedField < currentPersistedField;
}

/**
 * Expand persisted field IDs into application fields with stable precedence.
 * Owner provenance wins before timestamps or persisted-field ordering because
 * either historical subcategory array can represent the same protected pair.
 */
export function mergePersistedFieldStates(
  rows: readonly PersistedFieldStateRow[],
): Record<string, ApplicationFieldState> {
  const merged: Record<string, ApplicationFieldState> = {};
  const persistedFieldByApplicationField: Record<string, string> = {};

  for (const row of rows) {
    const candidate: ApplicationFieldState = {
      source: row.source,
      ...(row.updated_at ? { updatedAt: row.updated_at } : {}),
    };
    for (const applicationField of fromPersistedFieldIdentifiers(row.field)) {
      const current = merged[applicationField];
      const currentPersistedField =
        persistedFieldByApplicationField[applicationField];
      if (
        !current ||
        shouldReplaceFieldState(
          candidate,
          row.field,
          current,
          currentPersistedField,
        )
      ) {
        merged[applicationField] = candidate;
        persistedFieldByApplicationField[applicationField] = row.field;
      }
    }
  }

  return merged;
}

/**
 * Translate an application-shaped patch before passing it to a legacy RPC.
 *
 * `apply_brand_patch` and the approval RPC still record every JSON key they
 * receive in `brand_field_state`/`brand_field_events`. Keeping this conversion
 * beside the identifier helpers prevents new target names from leaking into
 * those persisted provenance rows until PR3 migrates their identifiers.
 */
export function toPersistedFieldPatch(
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const persisted: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(patch)) {
    const persistedField = toPersistedFieldIdentifier(field);
    if (
      Object.hasOwn(persisted, persistedField) &&
      !Object.is(persisted[persistedField], value)
    ) {
      throw new Error(
        `Conflicting values for persisted field identifier: ${persistedField}`,
      );
    }
    persisted[persistedField] = value;
  }
  return persisted;
}
