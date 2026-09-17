import { describe, expect, it, vi } from 'vitest'

import type { CheckUrlResult } from '../check-url'
import { checkBrandImageLinks } from '../brand-images'
import { fakeMultiTableClient, type FakeRow } from './helpers'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function imageRow(
  overrides: Partial<{
    id: string
    brand_id: string
    url: string
    status: string
  }> = {},
): FakeRow {
  return {
    id: overrides.id ?? 'img-1',
    brand_id: overrides.brand_id ?? 'brand-1',
    url: overrides.url ?? 'https://images.example.com/brand-1/hero.jpg',
    status: overrides.status ?? 'active',
  }
}

function brandRow(id: string): FakeRow {
  return { id, status: 'approved', slug: 'test-brand' }
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

describe('brand-images link checker', () => {
  it('emits exactly one finding listing dead links, and none when all are ok', async () => {
    const client = fakeMultiTableClient({
      brands: [brandRow('brand-1')],
      brand_images: [
        imageRow({ url: 'https://images.example.com/dead.jpg' }),
        imageRow({
          id: 'img-2',
          url: 'https://images.example.com/live.jpg',
        }),
      ],
    })
    const check = mockCheckUrl({
      'https://images.example.com/dead.jpg': {
        status: 'broken',
        statusCode: 404,
        resolvedUrl: null,
      },
    })

    const result = await checkBrandImageLinks({
      supabase: client,
      checkUrl: check,
    })
    expect(result.findings).toHaveLength(1)
    expect(result.dead).toBe(1)

    // All ok
    const clientOk = fakeMultiTableClient({
      brands: [brandRow('brand-1')],
      brand_images: [imageRow()],
    })
    const resultOk = await checkBrandImageLinks({
      supabase: clientOk,
      checkUrl: mockCheckUrl({}),
    })
    expect(resultOk.findings).toHaveLength(0)
  })

  it('does not write to brand data', async () => {
    const client = fakeMultiTableClient({
      brands: [brandRow('brand-1')],
      brand_images: [
        imageRow({ url: 'https://images.example.com/dead.jpg' }),
      ],
    })
    const check = mockCheckUrl({
      'https://images.example.com/dead.jpg': {
        status: 'broken',
        statusCode: 404,
        resolvedUrl: null,
      },
    })

    await checkBrandImageLinks({ supabase: client, checkUrl: check })
    expect(client._updates).toHaveLength(0)
  })

  it('counts blocked results without producing a finding', async () => {
    const client = fakeMultiTableClient({
      brands: [brandRow('brand-1')],
      brand_images: [
        imageRow({ url: 'https://images.example.com/blocked.jpg' }),
      ],
    })
    const check = mockCheckUrl({
      'https://images.example.com/blocked.jpg': {
        status: 'blocked',
        statusCode: 403,
        resolvedUrl: null,
      },
    })

    const result = await checkBrandImageLinks({
      supabase: client,
      checkUrl: check,
    })
    expect(result.blocked).toBe(1)
    expect(result.findings).toHaveLength(0)
  })

  it('only checks active images', async () => {
    const client = fakeMultiTableClient({
      brands: [brandRow('brand-1')],
      brand_images: [
        imageRow({
          id: 'active-img',
          url: 'https://images.example.com/active.jpg',
          status: 'active',
        }),
        imageRow({
          id: 'rejected-img',
          url: 'https://images.example.com/rejected.jpg',
          status: 'rejected',
        }),
      ],
    })
    const check = mockCheckUrl({
      'https://images.example.com/active.jpg': {
        status: 'broken',
        statusCode: 404,
        resolvedUrl: null,
      },
      'https://images.example.com/rejected.jpg': {
        status: 'broken',
        statusCode: 404,
        resolvedUrl: null,
      },
    })

    const result = await checkBrandImageLinks({
      supabase: client,
      checkUrl: check,
    })
    // Only the active image should be checked
    expect(result.checked).toBe(1)
    expect(result.dead).toBe(1)
  })
})
