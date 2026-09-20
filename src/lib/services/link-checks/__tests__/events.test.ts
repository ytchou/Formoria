import { describe, expect, it, vi } from 'vitest'

import type { CheckUrlResult } from '../check-url'
import { checkEventLinks } from '../events'
import { fakeClient, type FakeRow } from './helpers'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function eventRow(
  overrides: Partial<{
    id: string
    slug: string
    official_url: string | null
    ticket_url: string | null
    status: string
  }> = {},
): FakeRow {
  return {
    id: overrides.id ?? 'event-1',
    slug: overrides.slug ?? 'test-event',
    official_url: overrides.official_url ?? 'https://event.example.com',
    ticket_url: overrides.ticket_url ?? null,
    status: overrides.status ?? 'published',
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

describe('events link checker', () => {
  it('emits exactly one finding listing dead links, and none when all are ok', async () => {
    const client = fakeClient('events', [
      eventRow({ official_url: 'https://dead-event.example.com' }),
      eventRow({
        id: 'event-2',
        official_url: 'https://live-event.example.com',
      }),
    ])
    const check = mockCheckUrl({
      'https://dead-event.example.com': {
        status: 'broken',
        statusCode: 404,
        resolvedUrl: null,
      },
    })

    const result = await checkEventLinks({
      supabase: client,
      checkUrl: check,
    })
    expect(result.findings).toHaveLength(1)
    expect(result.dead).toBe(1)

    // All ok
    const clientOk = fakeClient('events', [eventRow()])
    const resultOk = await checkEventLinks({
      supabase: clientOk,
      checkUrl: mockCheckUrl({}),
    })
    expect(resultOk.findings).toHaveLength(0)
  })

  it('does not write to brand data', async () => {
    const client = fakeClient('events', [
      eventRow({ official_url: 'https://dead.example.com' }),
    ])
    const check = mockCheckUrl({
      'https://dead.example.com': {
        status: 'broken',
        statusCode: 404,
        resolvedUrl: null,
      },
    })

    await checkEventLinks({ supabase: client, checkUrl: check })
    expect(client._updates).toHaveLength(0)
  })

  it('counts blocked results without producing a finding', async () => {
    const client = fakeClient('events', [
      eventRow({ official_url: 'https://blocked.example.com' }),
    ])
    const check = mockCheckUrl({
      'https://blocked.example.com': {
        status: 'blocked',
        statusCode: 429,
        resolvedUrl: null,
      },
    })

    const result = await checkEventLinks({
      supabase: client,
      checkUrl: check,
    })
    expect(result.blocked).toBe(1)
    expect(result.findings).toHaveLength(0)
  })

  it('checks both official_url and ticket_url', async () => {
    const client = fakeClient('events', [
      eventRow({
        official_url: 'https://dead-official.example.com',
        ticket_url: 'https://dead-ticket.example.com',
      }),
    ])
    const check = mockCheckUrl({
      'https://dead-official.example.com': {
        status: 'broken',
        statusCode: 404,
        resolvedUrl: null,
      },
      'https://dead-ticket.example.com': {
        status: 'broken',
        statusCode: 410,
        resolvedUrl: null,
      },
    })

    const result = await checkEventLinks({
      supabase: client,
      checkUrl: check,
    })
    expect(result.dead).toBe(2)
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]!.evidence.deadLinks).toHaveLength(2)
  })
})
