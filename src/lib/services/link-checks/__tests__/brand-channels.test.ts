import { describe, expect, it, vi } from 'vitest'

import type { CheckUrlResult } from '../check-url'
import { checkBrandChannelLinks } from '../brand-channels'
import { fakeMultiTableClient, type FakeRow } from './helpers'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function channelRow(
  overrides: Partial<{
    id: string
    brand_id: string
    url: string | null
    removed_at: string | null
  }> = {},
): FakeRow {
  return {
    id: overrides.id ?? 'channel-1',
    brand_id: overrides.brand_id ?? 'brand-1',
    url: overrides.url ?? 'https://channel.example.com',
    removed_at: overrides.removed_at ?? null,
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

describe('brand-channels link checker', () => {
  it('emits exactly one finding listing dead links, and none when all are ok', async () => {
    const client = fakeMultiTableClient({
      brands: [brandRow('brand-1')],
      brand_channels: [
        channelRow({ url: 'https://dead-channel.example.com' }),
        channelRow({ id: 'channel-2', url: 'https://live-channel.example.com' }),
      ],
    })
    const check = mockCheckUrl({
      'https://dead-channel.example.com': {
        status: 'broken',
        statusCode: 404,
        resolvedUrl: null,
      },
    })

    const result = await checkBrandChannelLinks({
      supabase: client,
      checkUrl: check,
    })
    expect(result.findings).toHaveLength(1)
    expect(result.dead).toBe(1)

    // All ok
    const clientOk = fakeMultiTableClient({
      brands: [brandRow('brand-1')],
      brand_channels: [channelRow()],
    })
    const resultOk = await checkBrandChannelLinks({
      supabase: clientOk,
      checkUrl: mockCheckUrl({}),
    })
    expect(resultOk.findings).toHaveLength(0)
  })

  it('does not write to brand data', async () => {
    const client = fakeMultiTableClient({
      brands: [brandRow('brand-1')],
      brand_channels: [
        channelRow({ url: 'https://dead-channel.example.com' }),
      ],
    })
    const check = mockCheckUrl({
      'https://dead-channel.example.com': {
        status: 'broken',
        statusCode: 404,
        resolvedUrl: null,
      },
    })

    await checkBrandChannelLinks({ supabase: client, checkUrl: check })
    expect(client._updates).toHaveLength(0)
  })

  it('counts blocked results without producing a finding', async () => {
    const client = fakeMultiTableClient({
      brands: [brandRow('brand-1')],
      brand_channels: [
        channelRow({ url: 'https://blocked-channel.example.com' }),
      ],
    })
    const check = mockCheckUrl({
      'https://blocked-channel.example.com': {
        status: 'blocked',
        statusCode: 403,
        resolvedUrl: null,
      },
    })

    const result = await checkBrandChannelLinks({
      supabase: client,
      checkUrl: check,
    })
    expect(result.blocked).toBe(1)
    expect(result.findings).toHaveLength(0)
  })
})
