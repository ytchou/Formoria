import { describe, expect, it } from 'vitest'
import type {
  CuratedProductRow,
  CuratedSelectionRow,
  CuratedSourceRow,
} from './normalize'
import {
  CURATED_PRODUCT_WRITE_COLUMNS,
  planCuratedProductSync,
  type CuratedPlanOperation,
  type CuratedSyncPlanInput,
  type CurrentCuratedProduct,
  type CurrentCuratedSelection,
  type CurrentCuratedSource,
} from './plan'

const BRAND_ID = '11111111-1111-4111-8111-111111111111'
const PRODUCT_ID = '22222222-2222-4222-8222-222222222222'
const BRAND_IDS = { hanchor: BRAND_ID }

function product(overrides: Partial<CuratedProductRow> = {}): CuratedProductRow {
  return {
    brandSlug: 'hanchor',
    key: 'alpine-shell',
    nameZh: '高山風衣',
    nameEn: 'Alpine Shell',
    l1: 'fashion',
    l2: ['outerwear'],
    officialUrl: 'https://hanchor.com/alpine-shell',
    imageUrl: 'https://cdn.hanchor.com/alpine-shell.jpg',
    imageSourceUrl: 'https://hanchor.com/alpine-shell',
    imageUsage: 'permitted',
    lifecycle: 'published',
    sourceCheckedAt: '2026-08-01T00:00:00.000Z',
    reviewDueAt: '2026-11-01T00:00:00.000Z',
    notesZh: '防水透氣',
    notesEn: null,
    ...overrides,
  }
}

function source(overrides: Partial<CuratedSourceRow> = {}): CuratedSourceRow {
  return {
    brandSlug: 'hanchor',
    productKey: 'alpine-shell',
    url: 'https://hanchor.com/alpine-shell',
    sourceType: 'official',
    claimZh: '台灣製造',
    claimEn: null,
    checkedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  }
}

function selection(overrides: Partial<CuratedSelectionRow> = {}): CuratedSelectionRow {
  return {
    brandSlug: 'hanchor',
    productKey: 'alpine-shell',
    trailSlug: 'taiwan-outdoor',
    sectionKey: 'hero',
    position: 1,
    rationaleZh: '版型俐落',
    rationaleEn: 'Clean cut',
    ...overrides,
  }
}

function plan(input: Partial<CuratedSyncPlanInput> = {}) {
  return planCuratedProductSync({
    products: [],
    sources: [],
    selections: [],
    brandIdBySlug: BRAND_IDS,
    current: { products: [], sources: [], selections: [] },
    ...input,
  })
}

/** The DB row a product insert converges on, as if the plan had been applied. */
function appliedProduct(
  operations: CuratedPlanOperation[],
  id = PRODUCT_ID,
): CurrentCuratedProduct {
  const insert = operations.find((operation) => operation.kind === 'product.insert')
  if (!insert || insert.kind !== 'product.insert') throw new Error('no insert planned')
  return {
    id,
    link_state: 'unchecked',
    link_checked_at: null,
    ...insert.values,
  } as CurrentCuratedProduct
}

function currentSource(overrides: Partial<CurrentCuratedSource> = {}): CurrentCuratedSource {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    product_id: PRODUCT_ID,
    url: 'https://hanchor.com/alpine-shell',
    source_type: 'official',
    claim_zh: '台灣製造',
    claim_en: null,
    checked_at: '2026-08-01T00:00:00.000Z',
    state: 'active',
    ...overrides,
  }
}

function currentSelection(
  overrides: Partial<CurrentCuratedSelection> = {},
): CurrentCuratedSelection {
  return {
    product_id: PRODUCT_ID,
    trail_slug: 'taiwan-outdoor',
    section_key: 'hero',
    position: 1,
    rationale_zh: '版型俐落',
    rationale_en: 'Clean cut',
    state: 'active',
    ...overrides,
  }
}

describe('curated product sync planning', () => {
  it('plans inserts for products absent from the database', () => {
    const result = plan({ products: [product()] })

    expect(result.operations).toHaveLength(1)
    const [operation] = result.operations
    expect(operation).toMatchObject({
      kind: 'product.insert',
      table: 'curated_products',
      conflictTarget: ['brand_id', 'key'],
      product: { brandId: BRAND_ID, key: 'alpine-shell' },
    })
    expect(operation?.kind === 'product.insert' && operation.values).toMatchObject({
      brand_id: BRAND_ID,
      key: 'alpine-shell',
      name_zh: '高山風衣',
      l1: 'fashion',
      l2: ['outerwear'],
      lifecycle: 'published',
    })
    expect(result.totals.productInserts).toBe(1)
  })

  it('plans updates only for changed columns', () => {
    const seeded = appliedProduct(plan({ products: [product()] }).operations)
    const result = plan({
      products: [product({ nameEn: 'Alpine Shell II' })],
      current: { products: [seeded], sources: [], selections: [] },
    })

    expect(result.operations).toHaveLength(1)
    expect(result.operations[0]).toMatchObject({
      kind: 'product.update',
      id: PRODUCT_ID,
      set: { name_en: 'Alpine Shell II' },
    })
    const operation = result.operations[0]
    expect(operation?.kind === 'product.update' && Object.keys(operation.set)).toEqual([
      'name_en',
    ])
  })

  it('is idempotent — a second plan against the applied state is empty', () => {
    const first = plan({
      products: [product()],
      sources: [source()],
      selections: [selection()],
    })
    expect(first.operations.length).toBeGreaterThan(0)

    const second = plan({
      products: [product()],
      sources: [source()],
      selections: [selection()],
      current: {
        products: [appliedProduct(first.operations)],
        sources: [currentSource()],
        selections: [currentSelection()],
      },
    })

    expect(second.operations).toEqual([])
  })

  it('plans a retire, never a delete, for a product dropped from YAML', () => {
    const seeded = appliedProduct(plan({ products: [product()] }).operations)
    const result = plan({
      products: [],
      current: { products: [seeded], sources: [], selections: [] },
    })

    expect(result.operations).toEqual([
      {
        kind: 'product.retire',
        table: 'curated_products',
        conflictTarget: ['brand_id', 'key'],
        product: { brandId: BRAND_ID, key: 'alpine-shell' },
        id: PRODUCT_ID,
        set: { lifecycle: 'retired' },
      },
    ])
    expect(
      result.operations.every((operation) => !operation.kind.includes('delete')),
    ).toBe(true)
  })

  it('insert and update use the same column list', () => {
    const insertOperations = plan({ products: [product()] }).operations
    const seeded = appliedProduct(insertOperations)
    const changed = product({
      nameZh: '高山風衣 2',
      nameEn: null,
      l1: 'outdoor',
      l2: ['helmets'],
      officialUrl: null,
      imageUrl: null,
      imageSourceUrl: null,
      imageUsage: 'none',
      lifecycle: 'candidate',
      sourceCheckedAt: null,
      reviewDueAt: null,
      notesZh: null,
      notesEn: 'note',
    })
    const update = plan({
      products: [changed],
      current: { products: [seeded], sources: [], selections: [] },
    }).operations[0]

    const insert = insertOperations[0]
    expect(insert?.kind === 'product.insert' && Object.keys(insert.values)).toEqual([
      ...CURATED_PRODUCT_WRITE_COLUMNS,
    ])
    // brand_id and key identify the row, so they can never appear as changes;
    // every other authored column does, off the one shared constant.
    expect(update?.kind === 'product.update' && Object.keys(update.set)).toEqual(
      CURATED_PRODUCT_WRITE_COLUMNS.filter(
        (column) => column !== 'brand_id' && column !== 'key',
      ),
    )
  })

  it('never overwrites machine-written health columns', () => {
    expect(CURATED_PRODUCT_WRITE_COLUMNS).not.toContain('link_state')
    expect(CURATED_PRODUCT_WRITE_COLUMNS).not.toContain('link_checked_at')

    const insertOperations = plan({ products: [product()] }).operations
    const insert = insertOperations[0]
    expect(insert?.kind === 'product.insert' && Object.keys(insert.values)).not.toContain(
      'link_state',
    )

    const checked: CurrentCuratedProduct = {
      ...appliedProduct(insertOperations),
      link_state: 'broken',
      link_checked_at: '2026-08-10T00:00:00.000Z',
    }
    const result = plan({
      products: [product({ notesEn: 'changed' })],
      current: { products: [checked], sources: [], selections: [] },
    })

    expect(result.operations[0]).toMatchObject({
      kind: 'product.update',
      set: { notes_en: 'changed' },
    })
  })

  it('plans source upserts keyed on (product_id, url)', () => {
    const result = plan({ products: [product()], sources: [source()] })

    const upsert = result.operations.find((operation) => operation.kind === 'source.upsert')
    expect(upsert).toMatchObject({
      kind: 'source.upsert',
      table: 'curated_product_sources',
      conflictTarget: ['product_id', 'url'],
      product: { brandId: BRAND_ID, key: 'alpine-shell' },
      productId: null,
      url: 'https://hanchor.com/alpine-shell',
      values: {
        source_type: 'official',
        claim_zh: '台灣製造',
        claim_en: null,
        checked_at: '2026-08-01T00:00:00.000Z',
        state: 'active',
      },
    })
    // Children are keyed by a product id that does not exist until the parent
    // insert lands, so the parent operation must come first.
    expect(result.operations[0]?.kind).toBe('product.insert')
    expect(result.operations.indexOf(upsert!)).toBeGreaterThan(0)
  })

  it('plans selection upserts keyed on (product_id, trail_slug, section_key)', () => {
    const result = plan({ products: [product()], selections: [selection()] })

    const upsert = result.operations.find(
      (operation) => operation.kind === 'selection.upsert',
    )
    expect(upsert).toMatchObject({
      kind: 'selection.upsert',
      table: 'curated_product_selections',
      conflictTarget: ['product_id', 'trail_slug', 'section_key'],
      product: { brandId: BRAND_ID, key: 'alpine-shell' },
      trailSlug: 'taiwan-outdoor',
      sectionKey: 'hero',
      values: {
        position: 1,
        rationale_zh: '版型俐落',
        rationale_en: 'Clean cut',
        state: 'active',
      },
    })
    expect(result.operations[0]?.kind).toBe('product.insert')
  })

  it('retires a source or selection dropped from YAML rather than deleting it', () => {
    const seeded = appliedProduct(plan({ products: [product()] }).operations)
    const result = plan({
      products: [product()],
      sources: [],
      selections: [],
      current: {
        products: [seeded],
        sources: [currentSource()],
        selections: [currentSelection()],
      },
    })

    expect(result.operations).toEqual([
      {
        kind: 'source.retire',
        table: 'curated_product_sources',
        conflictTarget: ['product_id', 'url'],
        product: { brandId: BRAND_ID, key: 'alpine-shell' },
        productId: PRODUCT_ID,
        url: 'https://hanchor.com/alpine-shell',
        set: { state: 'retired' },
      },
      {
        kind: 'selection.retire',
        table: 'curated_product_selections',
        conflictTarget: ['product_id', 'trail_slug', 'section_key'],
        product: { brandId: BRAND_ID, key: 'alpine-shell' },
        productId: PRODUCT_ID,
        trailSlug: 'taiwan-outdoor',
        sectionKey: 'hero',
        set: { state: 'retired' },
      },
    ])
  })

  /**
   * The idempotency guarantee, at the format boundary. The YAML author writes
   * `2026-08-01T00:00:00Z`; PostgREST hands back `2026-08-01T00:00:00+00:00`
   * for the same instant. Comparing those as strings is false forever, so every
   * run re-emitted an update for every row, bumped `updated_at`, marked every
   * brand touched, and triggered a full revalidation.
   */
  it('treats two serialisations of the same instant as unchanged', () => {
    const seeded = appliedProduct(plan({ products: [product()] }).operations)
    const postgrest: CurrentCuratedProduct = {
      ...seeded,
      source_checked_at: '2026-08-01T00:00:00+00:00',
      review_due_at: '2026-11-01T00:00:00+00:00',
    }

    const result = plan({
      products: [
        product({
          sourceCheckedAt: '2026-08-01T00:00:00Z',
          reviewDueAt: '2026-11-01T00:00:00Z',
        }),
      ],
      sources: [source({ checkedAt: '2026-08-01T00:00:00Z' })],
      selections: [],
      current: {
        products: [postgrest],
        sources: [currentSource({ checked_at: '2026-08-01T00:00:00+00:00' })],
        selections: [],
      },
    })

    expect(result.operations).toEqual([])
    expect(result.totals.productUpdates).toBe(0)
    expect(result.totals.sourceUpserts).toBe(0)
  })

  it('still updates when the instant genuinely differs, or when one side is null', () => {
    const seeded = appliedProduct(plan({ products: [product()] }).operations)

    const moved = plan({
      products: [product({ sourceCheckedAt: '2026-08-02T00:00:00Z' })],
      current: {
        products: [{ ...seeded, source_checked_at: '2026-08-01T00:00:00+00:00' }],
        sources: [],
        selections: [],
      },
    })
    expect(moved.operations).toEqual([
      expect.objectContaining({
        kind: 'product.update',
        set: { source_checked_at: '2026-08-02T00:00:00Z' },
      }),
    ])

    // A null on exactly one side must never compare equal, or clearing a
    // timestamp would silently never be written.
    const cleared = plan({
      products: [product({ reviewDueAt: null })],
      current: {
        products: [{ ...seeded, review_due_at: '2026-11-01T00:00:00+00:00' }],
        sources: [],
        selections: [],
      },
    })
    expect(cleared.operations).toEqual([
      expect.objectContaining({
        kind: 'product.update',
        set: { review_due_at: null },
      }),
    ])
  })

  it('reports a brand slug with no matching brand id instead of planning writes', () => {
    const result = plan({ products: [product({ brandSlug: 'ghost-brand' })] })

    expect(result.operations).toEqual([])
    expect(result.unmatchedBrandSlugs).toEqual(['ghost-brand'])
  })
})
