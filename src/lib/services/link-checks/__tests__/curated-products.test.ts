import { describe, expect, it, vi } from 'vitest'

import type { CheckUrlResult } from '../check-url'
import { checkCuratedProductLinks } from '../curated-products'
import { fakeClient, type FakeRow } from './helpers'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function productRow(
  overrides: Partial<{
    id: string
    brand_id: string
    key: string
    visible: boolean
    official_url: string | null
    link_state: string
  }> = {},
): FakeRow {
  return {
    id: overrides.id ?? 'product-1',
    brand_id: overrides.brand_id ?? 'brand-1',
    key: overrides.key ?? 'test-product',
    visible: overrides.visible ?? true,
    official_url: overrides.official_url ?? 'https://shop.example.com/product',
    link_state: overrides.link_state ?? 'ok',
  }
}

function mockCheckUrl(
  results: Record<string, CheckUrlResult>,
): (url: string) => Promise<CheckUrlResult> {
  return vi.fn(async (url: string) =>
    results[url] ?? { status: 'ok', statusCode: 200, resolvedUrl: url },
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('curated-products link checker', () => {
  it('updates link_state and link_checked_at', async () => {
    const client = fakeClient('curated_products', [
      productRow({
        id: 'product-1',
        official_url: 'https://shop.example.com/product',
        link_state: 'ok',
      }),
    ])
    const check = mockCheckUrl({
      'https://shop.example.com/product': {
        status: 'broken',
        statusCode: 404,
        resolvedUrl: null,
      },
    })

    await checkCuratedProductLinks({ supabase: client, checkUrl: check })

    // Verify update was written
    expect(client._updates).toHaveLength(1)
    const update = client._updates[0]!
    expect(update.table).toBe('curated_products')
    expect(update.values).toHaveProperty('link_state', 'broken')
    expect(update.values).toHaveProperty('link_checked_at')
    // Only these two columns are written
    expect(Object.keys(update.values).sort()).toEqual([
      'link_checked_at',
      'link_state',
    ])
  })

  it('skips hidden products', async () => {
    const client = fakeClient('curated_products', [
      productRow({
        id: 'visible-product',
        visible: true,
        official_url: 'https://shop.example.com/visible',
      }),
      productRow({
        id: 'hidden-product',
        visible: false,
        official_url: 'https://shop.example.com/hidden',
      }),
    ])
    const check = mockCheckUrl({
      'https://shop.example.com/visible': {
        status: 'broken',
        statusCode: 404,
        resolvedUrl: null,
      },
      'https://shop.example.com/hidden': {
        status: 'broken',
        statusCode: 404,
        resolvedUrl: null,
      },
    })

    const result = await checkCuratedProductLinks({
      supabase: client,
      checkUrl: check,
    })

    // Only the visible product should be checked
    expect(result.checked).toBe(1)
    // Update only for the visible product
    expect(client._updates).toHaveLength(1)
    expect(client._updates[0]!.id).toBe('visible-product')
  })

  it('emits exactly one finding listing dead links, and none when all are ok', async () => {
    const client = fakeClient('curated_products', [
      productRow({
        id: 'p-1',
        official_url: 'https://shop.example.com/dead',
      }),
      productRow({
        id: 'p-2',
        official_url: 'https://shop.example.com/live',
      }),
    ])
    const check = mockCheckUrl({
      'https://shop.example.com/dead': {
        status: 'broken',
        statusCode: 404,
        resolvedUrl: null,
      },
    })

    const result = await checkCuratedProductLinks({
      supabase: client,
      checkUrl: check,
    })
    expect(result.findings).toHaveLength(1)

    // All ok
    const clientOk = fakeClient('curated_products', [productRow()])
    const resultOk = await checkCuratedProductLinks({
      supabase: clientOk,
      checkUrl: mockCheckUrl({}),
    })
    expect(resultOk.findings).toHaveLength(0)
  })

  it('does not update rows whose link_state has not changed', async () => {
    const client = fakeClient('curated_products', [
      productRow({
        id: 'p-1',
        official_url: 'https://shop.example.com/still-ok',
        link_state: 'ok',
      }),
    ])
    const check = mockCheckUrl({
      'https://shop.example.com/still-ok': {
        status: 'ok',
        statusCode: 200,
        resolvedUrl: 'https://shop.example.com/still-ok',
      },
    })

    await checkCuratedProductLinks({ supabase: client, checkUrl: check })

    // link_checked_at is still written even when the state does not change
    expect(client._updates).toHaveLength(1)
    expect(client._updates[0]!.values).toHaveProperty('link_state', 'ok')
  })

  it('reports a detector failure when zero rows are read', async () => {
    const client = fakeClient('curated_products', [])
    const result = await checkCuratedProductLinks({
      supabase: client,
      checkUrl: mockCheckUrl({}),
      requireNonEmpty: true,
    })
    expect(result.error).toBeDefined()
  })
})
