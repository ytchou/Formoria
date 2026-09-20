import { describe, expect, it } from 'vitest'
import { pagedRead } from '../paged-read'

// ---------------------------------------------------------------------------
// Fake Supabase client builder
// ---------------------------------------------------------------------------

function fakeClient<T>(
  pages: Array<{ data: T[] | null; error: unknown }>,
) {
  let callIndex = 0
  const rangeCalls: Array<{ from: number; to: number }> = []

  const builder = {
    select: () => builder,
    order: () => builder,
    eq: () => builder,
    range: (from: number, to: number) => {
      rangeCalls.push({ from, to })
      const page = pages[callIndex++]
      return Promise.resolve(page ?? { data: [], error: null })
    },
  }

  return {
    from: () => builder,
    rangeCalls,
  }
}

describe('pagedRead', () => {
  it('returns every row past the 1,000-row cap', async () => {
    // 2,350 rows: page 0 = 1,000, page 1 = 1,000, page 2 = 350
    const page0 = Array.from({ length: 1_000 }, (_, i) => ({ id: i }))
    const page1 = Array.from({ length: 1_000 }, (_, i) => ({ id: 1_000 + i }))
    const page2 = Array.from({ length: 350 }, (_, i) => ({ id: 2_000 + i }))

    const client = fakeClient([
      { data: page0, error: null },
      { data: page1, error: null },
      { data: page2, error: null },
    ])

    const rows = await pagedRead(client, 'test_table', {
      orderBy: [{ column: 'id', ascending: true }],
    })

    expect(rows).toHaveLength(2_350)
    // Verify ordered ranges
    expect(client.rangeCalls).toEqual([
      { from: 0, to: 999 },
      { from: 1_000, to: 1_999 },
      { from: 2_000, to: 2_999 },
    ])
  })

  it('throws on a page error instead of returning a partial set', async () => {
    const page0 = Array.from({ length: 1_000 }, (_, i) => ({ id: i }))
    const client = fakeClient([
      { data: page0, error: null },
      { data: null, error: new Error('connection reset') },
    ])

    await expect(
      pagedRead(client, 'test_table', {
        orderBy: [{ column: 'id', ascending: true }],
      }),
    ).rejects.toThrow('connection reset')
  })

  it('requireNonEmpty turns a zero-row required read into a failure', async () => {
    const client = fakeClient([{ data: [], error: null }])

    await expect(
      pagedRead(client, 'empty_table', {
        orderBy: [{ column: 'id', ascending: true }],
        requireNonEmpty: true,
      }),
    ).rejects.toThrow('zero rows')
  })
})
