import { describe, it, expect, vi } from 'vitest'
import { loadBrowserlessMonthlyCount, monthStartUtc } from '../monthly-gauge'

type CountResult = { count: number | null; error: { message: string } | null }

type RecordedQuery = {
  table: string | null
  columns: string | null
  options: unknown
  filters: Array<[string, string, string]>
}

/**
 * A hand-built stand-in for the count query, not a mocked supabase-js: the repo
 * forbids mocking `@supabase/…`, and what this test is actually about is the
 * FILTER SET the gauge sends. A fake that records the chain asserts exactly
 * that, and would keep failing if a filter were dropped.
 */
function fakeClient(result: CountResult | Error): {
  client: unknown
  recorded: RecordedQuery
} {
  const recorded: RecordedQuery = {
    table: null,
    columns: null,
    options: null,
    filters: [],
  }

  const query = {
    eq(column: string, value: string) {
      recorded.filters.push(['eq', column, value])
      return query
    },
    gte(column: string, value: string) {
      recorded.filters.push(['gte', column, value])
      return query
    },
    then<TResult1, TResult2>(
      onFulfilled?: ((value: CountResult) => TResult1 | PromiseLike<TResult1>) | null,
      onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): PromiseLike<TResult1 | TResult2> {
      return result instanceof Error
        ? Promise.reject(result).then(onFulfilled, onRejected)
        : Promise.resolve(result).then(onFulfilled, onRejected)
    },
  }

  const client = {
    from(table: string) {
      recorded.table = table
      return {
        select(columns: string, options: unknown) {
          recorded.columns = columns
          recorded.options = options
          return query
        },
      }
    },
  }

  return { client, recorded }
}

describe('monthStartUtc', () => {
  it('truncates to the first instant of the month in UTC', () => {
    expect(monthStartUtc(new Date('2026-09-17T08:30:00.000Z'))).toBe(
      '2026-09-01T00:00:00.000Z',
    )
  })

  it('does not slip a month for a late-UTC-day timestamp', () => {
    expect(monthStartUtc(new Date('2026-09-30T23:59:59.999Z'))).toBe(
      '2026-09-01T00:00:00.000Z',
    )
  })
})

describe('loadBrowserlessMonthlyCount', () => {
  it('counts succeeded browserless renders since the month start', async () => {
    const { client, recorded } = fakeClient({ count: 812, error: null })

    const count = await loadBrowserlessMonthlyCount(
      client,
      new Date('2026-09-17T08:30:00.000Z'),
    )

    expect(count).toBe(812)
    expect(recorded.table).toBe('external_call_audit')
    expect(recorded.columns).toBe('id')
    expect(recorded.options).toEqual({ count: 'exact', head: true })
    expect(recorded.filters).toEqual([
      ['eq', 'provider', 'browserless'],
      ['eq', 'operation', 'fetch_rendered'],
      ['eq', 'status', 'succeeded'],
      ['gte', 'created_at', '2026-09-01T00:00:00.000Z'],
    ])
  })

  it('reads zero as zero rather than as an unknown gauge', async () => {
    const { client } = fakeClient({ count: null, error: null })
    expect(await loadBrowserlessMonthlyCount(client)).toBe(0)
  })

  it('returns 0 when the query reports an error', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { client } = fakeClient({
      count: null,
      error: { message: 'permission denied for table external_call_audit' },
    })

    expect(await loadBrowserlessMonthlyCount(client)).toBe(0)
    warn.mockRestore()
  })

  it('returns 0 when the query throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { client } = fakeClient(new Error('network down'))

    expect(await loadBrowserlessMonthlyCount(client)).toBe(0)
    warn.mockRestore()
  })
})
