import type {
  CuratedProductRow,
  CuratedSelectionRow,
  CuratedSourceRow,
} from './normalize'

/**
 * Curated-product diff planner (DEV-1404).
 *
 * PURE BY CONTRACT: normalized rows plus the current DB rows in, an ordered
 * operation list out. No Supabase client, no `fetch`, no filesystem — the
 * caller reads and the caller writes.
 *
 * ORDERING IS LOAD-BEARING. Child rows are keyed by `product_id`, which does
 * not exist until the parent insert lands, so every product operation is
 * emitted before any source or selection operation, and each child operation
 * carries the `(brand_id, key)` business key for the applier to resolve to a
 * UUID after the parent write.
 *
 * RETIRE, NEVER DELETE. A row dropped from YAML is marked `retired`, because a
 * published trail may still reference it and a reused key must never silently
 * inherit another product's history.
 */

type ProductColumnValue = (row: CuratedProductRow, brandId: string) => unknown

/**
 * The ONE authored write set for `curated_products`.
 *
 * Both the insert path and the update path read their columns from this object
 * — there is deliberately no second literal list anywhere in this module.
 * `upsert_enriched_brand_channels` in this repo diverged its insert list from
 * its `on conflict do update set` list and re-imported rows silently lost
 * `district`: no error, no type failure, just a slowly growing data gap.
 *
 * `link_state` and `link_checked_at` are ABSENT on purpose. They belong to the
 * link-health checker; adding them here would reset every product's link health
 * to `unchecked` on each sync.
 */
const PRODUCT_COLUMN_VALUES = {
  brand_id: (_row, brandId) => brandId,
  key: (row) => row.key,
  name_zh: (row) => row.nameZh,
  name_en: (row) => row.nameEn,
  l1: (row) => row.l1,
  l2: (row) => row.l2,
  official_url: (row) => row.officialUrl,
  image_url: (row) => row.imageUrl,
  image_source_url: (row) => row.imageSourceUrl,
  image_usage: (row) => row.imageUsage,
  lifecycle: (row) => row.lifecycle,
  source_checked_at: (row) => row.sourceCheckedAt,
  review_due_at: (row) => row.reviewDueAt,
  notes_zh: (row) => row.notesZh,
  notes_en: (row) => row.notesEn,
} satisfies Record<string, ProductColumnValue>

export type CuratedProductWriteColumn = keyof typeof PRODUCT_COLUMN_VALUES

export const CURATED_PRODUCT_WRITE_COLUMNS = Object.keys(
  PRODUCT_COLUMN_VALUES,
) as CuratedProductWriteColumn[]

/** Columns that identify the row, so they can never appear as a change. */
const PRODUCT_IDENTITY_COLUMNS: CuratedProductWriteColumn[] = ['brand_id', 'key']

export const CURATED_PRODUCT_CONFLICT_TARGET = ['brand_id', 'key'] as const
export const CURATED_SOURCE_CONFLICT_TARGET = ['product_id', 'url'] as const
export const CURATED_SELECTION_CONFLICT_TARGET = [
  'product_id',
  'trail_slug',
  'section_key',
] as const

export type CuratedProductValues = Record<CuratedProductWriteColumn, unknown>

/**
 * Derived from the write set, so a column added to `PRODUCT_COLUMN_VALUES` is
 * automatically required on the current-state row too. `link_state` and
 * `link_checked_at` are read-only here: present so a caller can pass the whole
 * DB row, never compared and never written.
 */
export type CurrentCuratedProduct = CuratedProductValues & {
  id: string
  link_state?: string
  link_checked_at?: string | null
}

export type CurrentCuratedSource = {
  id: string
  product_id: string
  url: string
  source_type: string
  claim_zh: string | null
  claim_en: string | null
  checked_at: string | null
  state: string
}

export type CurrentCuratedSelection = {
  product_id: string
  trail_slug: string
  section_key: string
  position: number
  rationale_zh: string
  rationale_en: string | null
  state: string
}

/** The business key of a product, valid before the parent row exists. */
export type CuratedProductRef = { brandId: string; key: string }

export type CuratedPlanOperation =
  | {
      kind: 'product.insert'
      table: 'curated_products'
      conflictTarget: typeof CURATED_PRODUCT_CONFLICT_TARGET
      product: CuratedProductRef
      values: CuratedProductValues
    }
  | {
      kind: 'product.update'
      table: 'curated_products'
      conflictTarget: typeof CURATED_PRODUCT_CONFLICT_TARGET
      product: CuratedProductRef
      id: string
      set: Partial<CuratedProductValues>
    }
  | {
      kind: 'product.retire'
      table: 'curated_products'
      conflictTarget: typeof CURATED_PRODUCT_CONFLICT_TARGET
      product: CuratedProductRef
      id: string
      set: { lifecycle: 'retired' }
    }
  | {
      kind: 'source.upsert'
      table: 'curated_product_sources'
      conflictTarget: typeof CURATED_SOURCE_CONFLICT_TARGET
      product: CuratedProductRef
      /** `null` until the parent insert lands — resolve from `product`. */
      productId: string | null
      url: string
      values: Record<string, unknown>
    }
  | {
      kind: 'source.retire'
      table: 'curated_product_sources'
      conflictTarget: typeof CURATED_SOURCE_CONFLICT_TARGET
      product: CuratedProductRef
      productId: string
      url: string
      set: { state: 'retired' }
    }
  | {
      kind: 'selection.upsert'
      table: 'curated_product_selections'
      conflictTarget: typeof CURATED_SELECTION_CONFLICT_TARGET
      product: CuratedProductRef
      productId: string | null
      trailSlug: string
      sectionKey: string
      values: Record<string, unknown>
    }
  | {
      kind: 'selection.retire'
      table: 'curated_product_selections'
      conflictTarget: typeof CURATED_SELECTION_CONFLICT_TARGET
      product: CuratedProductRef
      productId: string
      trailSlug: string
      sectionKey: string
      set: { state: 'retired' }
    }

export type CuratedSyncPlanInput = {
  products: CuratedProductRow[]
  sources: CuratedSourceRow[]
  selections: CuratedSelectionRow[]
  /**
   * Brand id per authored slug. It also scopes the retire sweep: rows owned by
   * a brand outside this map are left alone, so syncing one brand's file can
   * never retire another brand's products.
   */
  brandIdBySlug: Record<string, string>
  current: {
    products: CurrentCuratedProduct[]
    sources: CurrentCuratedSource[]
    selections: CurrentCuratedSelection[]
  }
}

export type CuratedSyncPlan = {
  operations: CuratedPlanOperation[]
  unmatchedBrandSlugs: string[]
  totals: {
    productInserts: number
    productUpdates: number
    productRetires: number
    sourceUpserts: number
    sourceRetires: number
    selectionUpserts: number
    selectionRetires: number
  }
}

function productKey(brandId: string, key: string): string {
  return `${brandId}\u0000${key}`
}

function sameValue(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false
    return left.length === right.length && left.every((item, i) => item === right[i])
  }
  return left === right
}

function buildProductValues(
  row: CuratedProductRow,
  brandId: string,
): CuratedProductValues {
  return Object.fromEntries(
    CURATED_PRODUCT_WRITE_COLUMNS.map((column) => [
      column,
      PRODUCT_COLUMN_VALUES[column](row, brandId),
    ]),
  ) as CuratedProductValues
}

function sourceValues(row: CuratedSourceRow): Record<string, unknown> {
  return {
    source_type: row.sourceType,
    claim_zh: row.claimZh,
    claim_en: row.claimEn,
    checked_at: row.checkedAt,
    state: 'active',
  }
}

function selectionValues(row: CuratedSelectionRow): Record<string, unknown> {
  return {
    position: row.position,
    rationale_zh: row.rationaleZh,
    rationale_en: row.rationaleEn,
    state: 'active',
  }
}

function currentSourceValues(row: CurrentCuratedSource): Record<string, unknown> {
  return {
    source_type: row.source_type,
    claim_zh: row.claim_zh,
    claim_en: row.claim_en,
    checked_at: row.checked_at,
    state: row.state,
  }
}

function currentSelectionValues(row: CurrentCuratedSelection): Record<string, unknown> {
  return {
    position: row.position,
    rationale_zh: row.rationale_zh,
    rationale_en: row.rationale_en,
    state: row.state,
  }
}

function sameRecord(
  desired: Record<string, unknown>,
  current: Record<string, unknown>,
): boolean {
  return Object.keys(desired).every((key) => sameValue(desired[key], current[key]))
}

export function planCuratedProductSync(input: CuratedSyncPlanInput): CuratedSyncPlan {
  const operations: CuratedPlanOperation[] = []
  const unmatchedBrandSlugs = new Set<string>()

  const resolveBrandId = (brandSlug: string): string | null => {
    const brandId = input.brandIdBySlug[brandSlug]
    if (!brandId) {
      unmatchedBrandSlugs.add(brandSlug)
      return null
    }
    return brandId
  }

  const inScopeBrandIds = new Set(Object.values(input.brandIdBySlug))
  const currentProductByKey = new Map<string, CurrentCuratedProduct>()
  for (const row of input.current.products) {
    currentProductByKey.set(
      productKey(String(row.brand_id), String(row.key)),
      row,
    )
  }
  const currentProductById = new Map(
    input.current.products.map((row) => [row.id, row]),
  )

  // --- products -------------------------------------------------------------
  const desiredProductKeys = new Set<string>()
  const productIdByKey = new Map<string, string>()
  const desiredProducts: Array<{ row: CuratedProductRow; brandId: string }> = []

  for (const row of input.products) {
    const brandId = resolveBrandId(row.brandSlug)
    if (!brandId) continue
    desiredProducts.push({ row, brandId })
    const identity = productKey(brandId, row.key)
    desiredProductKeys.add(identity)
    const current = currentProductByKey.get(identity)
    if (current) productIdByKey.set(identity, current.id)
  }

  for (const { row, brandId } of desiredProducts) {
    const identity = productKey(brandId, row.key)
    const values = buildProductValues(row, brandId)
    const current = currentProductByKey.get(identity)

    if (!current) {
      operations.push({
        kind: 'product.insert',
        table: 'curated_products',
        conflictTarget: CURATED_PRODUCT_CONFLICT_TARGET,
        product: { brandId, key: row.key },
        values,
      })
      continue
    }

    const set: Partial<CuratedProductValues> = {}
    for (const column of CURATED_PRODUCT_WRITE_COLUMNS) {
      if (PRODUCT_IDENTITY_COLUMNS.includes(column)) continue
      if (!sameValue(values[column], current[column])) {
        set[column] = values[column]
      }
    }
    if (Object.keys(set).length > 0) {
      operations.push({
        kind: 'product.update',
        table: 'curated_products',
        conflictTarget: CURATED_PRODUCT_CONFLICT_TARGET,
        product: { brandId, key: row.key },
        id: current.id,
        set,
      })
    }
  }

  for (const current of input.current.products) {
    const brandId = String(current.brand_id)
    if (!inScopeBrandIds.has(brandId)) continue
    const identity = productKey(brandId, String(current.key))
    if (desiredProductKeys.has(identity)) continue
    if (current.lifecycle === 'retired') continue
    operations.push({
      kind: 'product.retire',
      table: 'curated_products',
      conflictTarget: CURATED_PRODUCT_CONFLICT_TARGET,
      product: { brandId, key: String(current.key) },
      id: current.id,
      set: { lifecycle: 'retired' },
    })
  }

  // --- sources --------------------------------------------------------------
  const desiredSourceKeys = new Set<string>()
  for (const row of input.sources) {
    const brandId = resolveBrandId(row.brandSlug)
    if (!brandId) continue
    const identity = productKey(brandId, row.productKey)
    const productId = productIdByKey.get(identity) ?? null
    desiredSourceKeys.add(`${identity}\u0000${row.url}`)

    const values = sourceValues(row)
    if (productId) {
      const current = input.current.sources.find(
        (candidate) => candidate.product_id === productId && candidate.url === row.url,
      )
      if (current && sameRecord(values, currentSourceValues(current))) continue
    }

    operations.push({
      kind: 'source.upsert',
      table: 'curated_product_sources',
      conflictTarget: CURATED_SOURCE_CONFLICT_TARGET,
      product: { brandId, key: row.productKey },
      productId,
      url: row.url,
      values,
    })
  }

  for (const current of input.current.sources) {
    const parent = currentProductById.get(current.product_id)
    if (!parent || !inScopeBrandIds.has(String(parent.brand_id))) continue
    const identity = productKey(String(parent.brand_id), String(parent.key))
    if (desiredSourceKeys.has(`${identity}\u0000${current.url}`)) continue
    if (current.state === 'retired') continue
    operations.push({
      kind: 'source.retire',
      table: 'curated_product_sources',
      conflictTarget: CURATED_SOURCE_CONFLICT_TARGET,
      product: { brandId: String(parent.brand_id), key: String(parent.key) },
      productId: current.product_id,
      url: current.url,
      set: { state: 'retired' },
    })
  }

  // --- selections -----------------------------------------------------------
  const desiredSelectionKeys = new Set<string>()
  for (const row of input.selections) {
    const brandId = resolveBrandId(row.brandSlug)
    if (!brandId) continue
    const identity = productKey(brandId, row.productKey)
    const productId = productIdByKey.get(identity) ?? null
    desiredSelectionKeys.add(`${identity}\u0000${row.trailSlug}\u0000${row.sectionKey}`)

    const values = selectionValues(row)
    if (productId) {
      const current = input.current.selections.find(
        (candidate) =>
          candidate.product_id === productId &&
          candidate.trail_slug === row.trailSlug &&
          candidate.section_key === row.sectionKey,
      )
      if (current && sameRecord(values, currentSelectionValues(current))) continue
    }

    operations.push({
      kind: 'selection.upsert',
      table: 'curated_product_selections',
      conflictTarget: CURATED_SELECTION_CONFLICT_TARGET,
      product: { brandId, key: row.productKey },
      productId,
      trailSlug: row.trailSlug,
      sectionKey: row.sectionKey,
      values,
    })
  }

  for (const current of input.current.selections) {
    const parent = currentProductById.get(current.product_id)
    if (!parent || !inScopeBrandIds.has(String(parent.brand_id))) continue
    const identity = productKey(String(parent.brand_id), String(parent.key))
    const key = `${identity}\u0000${current.trail_slug}\u0000${current.section_key}`
    if (desiredSelectionKeys.has(key)) continue
    if (current.state === 'retired') continue
    operations.push({
      kind: 'selection.retire',
      table: 'curated_product_selections',
      conflictTarget: CURATED_SELECTION_CONFLICT_TARGET,
      product: { brandId: String(parent.brand_id), key: String(parent.key) },
      productId: current.product_id,
      trailSlug: current.trail_slug,
      sectionKey: current.section_key,
      set: { state: 'retired' },
    })
  }

  const count = (kind: CuratedPlanOperation['kind']): number =>
    operations.filter((operation) => operation.kind === kind).length

  return {
    operations,
    unmatchedBrandSlugs: [...unmatchedBrandSlugs].sort(),
    totals: {
      productInserts: count('product.insert'),
      productUpdates: count('product.update'),
      productRetires: count('product.retire'),
      sourceUpserts: count('source.upsert'),
      sourceRetires: count('source.retire'),
      selectionUpserts: count('selection.upsert'),
      selectionRetires: count('selection.retire'),
    },
  }
}
