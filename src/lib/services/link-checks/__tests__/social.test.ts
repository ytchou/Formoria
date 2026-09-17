import { describe, expect, it, vi } from 'vitest'

import type { CheckUrlResult } from '../check-url'
import { checkSocialLinks } from '../social'
import { fakeClient, type FakeRow } from './helpers'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function brandRow(
  overrides: Partial<{
    id: string
    slug: string
    social_instagram: string | null
    social_facebook: string | null
    social_threads: string | null
  }> = {},
): FakeRow {
  return {
    id: overrides.id ?? 'brand-1',
    slug: overrides.slug ?? 'test-brand',
    status: 'approved',
    social_instagram: overrides.social_instagram ?? null,
    social_facebook: overrides.social_facebook ?? null,
    social_threads: overrides.social_threads ?? null,
  }
}

function mockCheckUrl(
  results: Record<string, CheckUrlResult>,
): (url: string) => Promise<CheckUrlResult> {
  return vi.fn(async (url: string) => {
    return (
      results[url] ?? { status: 'ok', statusCode: 200, resolvedUrl: url }
    )
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('social link checker', () => {
  it('classifies a platform not-found page as dead', async () => {
    const client = fakeClient('brands', [
      brandRow({
        social_instagram: 'https://instagram.com/deleted-brand',
      }),
    ])
    const check = mockCheckUrl({
      'https://instagram.com/deleted-brand': {
        status: 'broken',
        statusCode: 404,
        resolvedUrl: 'https://instagram.com/deleted-brand',
      },
    })

    const result = await checkSocialLinks({ supabase: client, checkUrl: check })

    expect(result.dead).toBe(1)
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]!.title).toContain('dead')
  })

  it('classifies a login wall, 429 and challenge page as blocked, never dead', async () => {
    const client = fakeClient('brands', [
      brandRow({
        id: 'brand-1',
        social_instagram: 'https://instagram.com/login-wall',
        social_facebook: 'https://facebook.com/rate-limited',
        social_threads: 'https://threads.net/challenge',
      }),
    ])
    const check = mockCheckUrl({
      'https://instagram.com/login-wall': {
        status: 'blocked',
        statusCode: 403,
        resolvedUrl: 'https://instagram.com/accounts/login/',
      },
      'https://facebook.com/rate-limited': {
        status: 'blocked',
        statusCode: 429,
        resolvedUrl: 'https://facebook.com/rate-limited',
      },
      'https://threads.net/challenge': {
        status: 'blocked',
        statusCode: 403,
        resolvedUrl: 'https://threads.net/challenge',
      },
    })

    const result = await checkSocialLinks({ supabase: client, checkUrl: check })

    expect(result.blocked).toBe(3)
    expect(result.dead).toBe(0)
    // Blocked results produce no finding
    expect(result.findings).toHaveLength(0)
  })

  it('blocked results are counted in the summary and produce no finding', async () => {
    const client = fakeClient('brands', [
      brandRow({
        social_instagram: 'https://instagram.com/blocked-account',
      }),
    ])
    const check = mockCheckUrl({
      'https://instagram.com/blocked-account': {
        status: 'blocked',
        statusCode: 429,
        resolvedUrl: null,
      },
    })

    const result = await checkSocialLinks({ supabase: client, checkUrl: check })

    expect(result.blocked).toBe(1)
    expect(result.findings).toHaveLength(0)
  })

  it('emits exactly one finding listing its dead links, and none when there are no dead links', async () => {
    // With dead links — one finding
    const client = fakeClient('brands', [
      brandRow({
        id: 'brand-1',
        slug: 'brand-a',
        social_instagram: 'https://instagram.com/dead1',
        social_facebook: 'https://facebook.com/dead2',
      }),
    ])
    const check = mockCheckUrl({
      'https://instagram.com/dead1': {
        status: 'broken',
        statusCode: 404,
        resolvedUrl: null,
      },
      'https://facebook.com/dead2': {
        status: 'broken',
        statusCode: 410,
        resolvedUrl: null,
      },
    })

    const result = await checkSocialLinks({ supabase: client, checkUrl: check })
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]!.evidence.deadLinks).toHaveLength(2)

    // Without dead links — no findings
    const clientOk = fakeClient('brands', [
      brandRow({ social_instagram: 'https://instagram.com/live' }),
    ])
    const checkOk = mockCheckUrl({})
    const resultOk = await checkSocialLinks({
      supabase: clientOk,
      checkUrl: checkOk,
    })
    expect(resultOk.findings).toHaveLength(0)
  })

  it('does not write to brand data', async () => {
    const client = fakeClient('brands', [
      brandRow({
        social_instagram: 'https://instagram.com/dead',
      }),
    ])
    const check = mockCheckUrl({
      'https://instagram.com/dead': {
        status: 'broken',
        statusCode: 404,
        resolvedUrl: null,
      },
    })

    await checkSocialLinks({ supabase: client, checkUrl: check })

    // The client should have received no update/insert/upsert calls
    expect(client._updates).toHaveLength(0)
  })

  it('reports a detector failure when zero rows are read', async () => {
    const client = fakeClient('brands', [])
    const check = mockCheckUrl({})

    const result = await checkSocialLinks({
      supabase: client,
      checkUrl: check,
      requireNonEmpty: true,
    })

    expect(result.error).toBeDefined()
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]!.title).toContain('zero')
  })
})
