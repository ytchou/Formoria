import { describe, expect, it } from 'vitest'
import {
  loadStoredCandidates,
  type StoredCandidateReader,
} from '../stored-product-candidates'

// ---------------------------------------------------------------------------
// Helpers — injectable Supabase double
// ---------------------------------------------------------------------------

/**
 * Builds a recording client double that mirrors the PostgREST chaining API.
 * No module mocking — the reader type is injected, satisfying check-test-boundaries.
 */
function buildDouble(
  tables: Record<string, Record<string, unknown>[]>
): StoredCandidateReader {
  return {
    from(table: string) {
      return {
        select(_columns: string) {
          return buildQuery(tables[table] ?? [])
        },
      }
    },
  } as StoredCandidateReader
}

type EqFilter = { column: string; value: unknown }

/**
 * Builds a query double that collects `.eq()` filters and resolves as a
 * real Promise — satisfying the full `PromiseLike` interface that
 * `StoredCandidateReader` declares.
 */
function buildQuery(rows: Record<string, unknown>[]) {
  const filters: EqFilter[] = []

  function resolve(): Promise<{ data: Record<string, unknown>[]; error: null }> {
    let filtered = [...rows]
    for (const f of filters) {
      filtered = filtered.filter((r) => r[f.column] === f.value)
    }
    return Promise.resolve({ data: filtered, error: null })
  }

  const chain: Record<string, unknown> = {
    eq(column: string, value: unknown) {
      filters.push({ column, value })
      return chain
    },
    then: (...args: Parameters<Promise<unknown>['then']>) =>
      resolve().then(...args),
    catch: (...args: Parameters<Promise<unknown>['catch']>) =>
      resolve().catch(...args),
  }

  return chain
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const SUBMISSION_ID = 'sub-001'
const BRAND_ID = 'brand-001'

const SUBMISSION_ROW = {
  id: SUBMISSION_ID,
  brand_id: BRAND_ID,
}

const ACTIVE_IMAGE = {
  id: 'img-001',
  brand_id: BRAND_ID,
  source_url: 'https://example.com/img/plate.jpg',
  status: 'active',
  provider_metadata: {
    pageUrl: 'https://example.com/products/plate',
    title: 'Ceramic Plate',
    position: 2,
  },
}

const REJECTED_IMAGE = {
  id: 'img-002',
  brand_id: BRAND_ID,
  source_url: 'https://example.com/img/old.jpg',
  status: 'rejected',
  provider_metadata: {
    pageUrl: 'https://example.com/products/old',
    title: 'Old Product',
    position: 5,
  },
}

const NO_PAGE_URL_IMAGE = {
  id: 'img-003',
  brand_id: BRAND_ID,
  source_url: 'https://example.com/img/logo.jpg',
  status: 'active',
  provider_metadata: {},
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('loadStoredCandidates', () => {
  it('resolves_submission_to_brand_id', async () => {
    const client = buildDouble({
      brand_submissions: [SUBMISSION_ROW],
      brand_images: [ACTIVE_IMAGE],
    })
    const result = await loadStoredCandidates(SUBMISSION_ID, client)

    // Should have queried brand_submissions for the target id,
    // then brand_images by the returned brand_id
    expect(result).toHaveLength(1)
    expect(result[0].url).toBe('https://example.com/products/plate')
    expect(result[0].supplier).toBe('stored')
  })

  it('returns_empty_when_submission_has_no_brand_id', async () => {
    const client = buildDouble({
      brand_submissions: [{ id: SUBMISSION_ID, brand_id: null }],
      brand_images: [],
    })
    const result = await loadStoredCandidates(SUBMISSION_ID, client)
    expect(result).toEqual([])
  })

  it('filters_to_active_status', async () => {
    const client = buildDouble({
      brand_submissions: [SUBMISSION_ROW],
      brand_images: [ACTIVE_IMAGE, REJECTED_IMAGE],
    })
    const result = await loadStoredCandidates(SUBMISSION_ID, client)
    // Only the active image should produce a candidate
    expect(result).toHaveLength(1)
    expect(result[0].url).toBe('https://example.com/products/plate')
  })

  it('extracts_page_url_title_and_position', async () => {
    const client = buildDouble({
      brand_submissions: [SUBMISSION_ROW],
      brand_images: [ACTIVE_IMAGE],
    })
    const result = await loadStoredCandidates(SUBMISSION_ID, client)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      url: 'https://example.com/products/plate',
      title: 'Ceramic Plate',
      searchPosition: 2,
      imageUrl: 'https://example.com/img/plate.jpg',
      supplier: 'stored',
    })
  })

  it('skips_rows_without_page_url', async () => {
    const client = buildDouble({
      brand_submissions: [SUBMISSION_ROW],
      brand_images: [ACTIVE_IMAGE, NO_PAGE_URL_IMAGE],
    })
    const result = await loadStoredCandidates(SUBMISSION_ID, client)
    // Only the row with pageUrl should survive
    expect(result).toHaveLength(1)
    expect(result[0].url).toBe('https://example.com/products/plate')
  })
})
