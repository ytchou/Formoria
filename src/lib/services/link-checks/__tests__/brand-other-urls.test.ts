import { describe, expect, it, vi } from 'vitest'

import type { CheckUrlResult } from '../check-url'
import { checkBrandOtherUrls } from '../brand-other-urls'
import { fakeClient, type FakeRow } from './helpers'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function brandRow(
  overrides: Partial<{
    id: string
    slug: string
    other_urls: Array<{ label: string; url: string }>
  }> = {},
): FakeRow {
  return {
    id: overrides.id ?? 'brand-1',
    slug: overrides.slug ?? 'test-brand',
    status: 'approved',
    other_urls: overrides.other_urls ?? [],
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

describe('brand-other-urls link checker', () => {
  it('emits exactly one finding listing dead links, and none when all are ok', async () => {
    const client = fakeClient('brands', [
      brandRow({
        other_urls: [
          { label: 'Blog', url: 'https://blog.example.com' },
          { label: 'Press', url: 'https://press.example.com' },
        ],
      }),
    ])
    const check = mockCheckUrl({
      'https://blog.example.com': {
        status: 'broken',
        statusCode: 404,
        resolvedUrl: null,
      },
    })

    const result = await checkBrandOtherUrls({
      supabase: client,
      checkUrl: check,
    })
    expect(result.findings).toHaveLength(1)
    expect(result.dead).toBe(1)

    // All ok — no findings
    const clientOk = fakeClient('brands', [
      brandRow({
        other_urls: [{ label: 'Blog', url: 'https://blog.example.com' }],
      }),
    ])
    const resultOk = await checkBrandOtherUrls({
      supabase: clientOk,
      checkUrl: mockCheckUrl({}),
    })
    expect(resultOk.findings).toHaveLength(0)
  })

  it('does not write to brand data', async () => {
    const client = fakeClient('brands', [
      brandRow({
        other_urls: [{ label: 'Blog', url: 'https://dead.example.com' }],
      }),
    ])
    const check = mockCheckUrl({
      'https://dead.example.com': {
        status: 'broken',
        statusCode: 404,
        resolvedUrl: null,
      },
    })

    await checkBrandOtherUrls({ supabase: client, checkUrl: check })
    expect(client._updates).toHaveLength(0)
  })

  it('reports a detector failure when zero rows are read', async () => {
    const client = fakeClient('brands', [])
    const result = await checkBrandOtherUrls({
      supabase: client,
      checkUrl: mockCheckUrl({}),
      requireNonEmpty: true,
    })
    expect(result.error).toBeDefined()
  })

  it('counts blocked results in the summary and produces no finding for them', async () => {
    const client = fakeClient('brands', [
      brandRow({
        other_urls: [{ label: 'Shop', url: 'https://blocked.example.com' }],
      }),
    ])
    const check = mockCheckUrl({
      'https://blocked.example.com': {
        status: 'blocked',
        statusCode: 403,
        resolvedUrl: null,
      },
    })

    const result = await checkBrandOtherUrls({
      supabase: client,
      checkUrl: check,
    })
    expect(result.blocked).toBe(1)
    expect(result.findings).toHaveLength(0)
  })
})
