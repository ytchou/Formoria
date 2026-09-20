/**
 * Shared test helpers for link-check class tests.
 *
 * Provides a fake Supabase client that records queries and updates, matching
 * the pattern from `detectors/__tests__/images.test.ts`.
 */

import type { LinkCheckClient, LinkCheckWriter } from '../types'

export type FakeRow = Record<string, unknown>

type UpdateRecord = {
  table: string
  values: Record<string, unknown>
  id: string
}

/**
 * Fake Supabase client that serves canned rows for a given table and records
 * all update calls. Supports `.eq()` filtering used by `pagedRead`.
 */
export function fakeClient(
  _expectedTable: string,
  rows: FakeRow[],
): LinkCheckClient & LinkCheckWriter & { _updates: UpdateRecord[] } {
  const updates: UpdateRecord[] = []

  const client: LinkCheckClient & LinkCheckWriter & { _updates: UpdateRecord[] } = {
    _updates: updates,
    from(table: string) {
      let filtered = [...rows]
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (_col: string, val: unknown) => {
          filtered = filtered.filter(
            (r) => r[_col] === val,
          )
          return builder
        },
        neq: (_col: string, val: unknown) => {
          filtered = filtered.filter(
            (r) => r[_col] !== val,
          )
          return builder
        },
        in: (_col: string, vals: unknown[]) => {
          const valSet = new Set(vals)
          filtered = filtered.filter(
            (r) => valSet.has(r[_col]),
          )
          return builder
        },
        is: (_col: string, val: unknown) => {
          if (val === null) {
            filtered = filtered.filter((r) => r[_col] == null)
          }
          return builder
        },
        not: (_col: string, _op: string, val: unknown) => {
          if (_op === 'is' && val === null) {
            filtered = filtered.filter((r) => r[_col] != null)
          }
          return builder
        },
        order: () => builder,
        range: (from: number, to: number) =>
          Promise.resolve({
            data: filtered.slice(from, to + 1),
            error: null,
          }),
        update: (values: Record<string, unknown>) => ({
          eq: (_col: string, val: string) => {
            updates.push({ table, values, id: val })
            return Promise.resolve({ error: null })
          },
        }),
      }
      return builder as ReturnType<LinkCheckClient['from']> & ReturnType<LinkCheckWriter['from']>
    },
  }
  return client
}

/**
 * Multi-table fake client for tests that read from multiple tables.
 */
export function fakeMultiTableClient(
  tables: Record<string, FakeRow[]>,
): LinkCheckClient & LinkCheckWriter & { _updates: UpdateRecord[] } {
  const updates: UpdateRecord[] = []

  const client: LinkCheckClient & LinkCheckWriter & { _updates: UpdateRecord[] } = {
    _updates: updates,
    from(table: string) {
      const tableRows = tables[table] ?? []
      let filtered = [...tableRows]
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          filtered = filtered.filter((r) => r[col] === val)
          return builder
        },
        neq: (col: string, val: unknown) => {
          filtered = filtered.filter((r) => r[col] !== val)
          return builder
        },
        in: (col: string, vals: unknown[]) => {
          const valSet = new Set(vals)
          filtered = filtered.filter((r) => valSet.has(r[col]))
          return builder
        },
        is: (col: string, val: unknown) => {
          if (val === null) {
            filtered = filtered.filter((r) => r[col] == null)
          }
          return builder
        },
        not: (col: string, _op: string, val: unknown) => {
          if (_op === 'is' && val === null) {
            filtered = filtered.filter((r) => r[col] != null)
          }
          return builder
        },
        order: () => builder,
        range: (from: number, to: number) =>
          Promise.resolve({
            data: filtered.slice(from, to + 1),
            error: null,
          }),
        update: (values: Record<string, unknown>) => ({
          eq: (_col: string, val: string) => {
            updates.push({ table, values, id: val })
            return Promise.resolve({ error: null })
          },
        }),
      }
      return builder as ReturnType<LinkCheckClient['from']> & ReturnType<LinkCheckWriter['from']>
    },
  }
  return client
}
