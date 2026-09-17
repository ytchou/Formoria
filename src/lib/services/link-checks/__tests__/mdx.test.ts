import { describe, expect, it, vi } from 'vitest'

import type { CheckUrlResult } from '../check-url'
import { checkMdxLinks } from '../mdx'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

describe('mdx link checker', () => {
  it('takes extracted links as input and performs no filesystem read', async () => {
    // The checker receives pre-extracted links — no fs module needed.
    const links = [
      { file: 'content/stories/test.mdx', url: 'https://example.com' },
      { file: 'content/stories/test.mdx', url: 'https://dead.example.com' },
    ]
    const check = mockCheckUrl({
      'https://dead.example.com': {
        status: 'broken',
        statusCode: 404,
        resolvedUrl: null,
      },
    })

    const result = await checkMdxLinks({ links, checkUrl: check })

    expect(result.checked).toBe(2)
    expect(result.dead).toBe(1)
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]!.evidence.deadLinks).toHaveLength(1)
  })

  it('emits no finding when there are no dead links', async () => {
    const links = [
      { file: 'content/stories/test.mdx', url: 'https://example.com' },
    ]
    const check = mockCheckUrl({})

    const result = await checkMdxLinks({ links, checkUrl: check })

    expect(result.findings).toHaveLength(0)
    expect(result.dead).toBe(0)
  })

  it('counts blocked results in the summary and produces no finding for them', async () => {
    const links = [
      { file: 'content/stories/test.mdx', url: 'https://blocked.example.com' },
    ]
    const check = mockCheckUrl({
      'https://blocked.example.com': {
        status: 'blocked',
        statusCode: 429,
        resolvedUrl: null,
      },
    })

    const result = await checkMdxLinks({ links, checkUrl: check })

    expect(result.blocked).toBe(1)
    expect(result.findings).toHaveLength(0)
  })

  it('handles an empty link list without error', async () => {
    const check = mockCheckUrl({})
    const result = await checkMdxLinks({ links: [], checkUrl: check })

    expect(result.checked).toBe(0)
    expect(result.findings).toHaveLength(0)
  })

  it('deduplicates URLs across files', async () => {
    const links = [
      { file: 'content/stories/a.mdx', url: 'https://example.com' },
      { file: 'content/stories/b.mdx', url: 'https://example.com' },
    ]
    const check = mockCheckUrl({})

    const result = await checkMdxLinks({ links, checkUrl: check })

    // URL checked once, not twice
    expect(check).toHaveBeenCalledTimes(1)
    expect(result.checked).toBe(1)
  })
})
