/**
 * Paged reads from Supabase tables.
 *
 * Follows `src/lib/services/trail-supply-report.ts` lines 262-281:
 * `.order()` before `.range()`, page size 1,000.
 *
 * Without a total order the same row can appear on two pages and another on
 * none. Callers must supply at least one order column that forms a total
 * ordering (typically the primary key).
 */

const PAGE_SIZE = 1_000

/**
 * Maximum pages before giving up. Safety net against infinite loops when
 * a table is larger than expected.
 *
 * Ceiling: raise to 100 if a monitored table grows past 50k rows.
 */
const MAX_PAGES = 50

/**
 * Minimal Supabase query builder shape — just enough to page.
 * Accepts any object that can `.select()`, `.order()`, and `.range()`.
 */
export type PageableQuery<T> = {
  select: (columns: string) => PageableQuery<T>
  order: (column: string, options?: { ascending: boolean }) => PageableQuery<T>
  range: (from: number, to: number) => Promise<{ data: T[] | null; error: unknown }>
  eq: (column: string, value: unknown) => PageableQuery<T>
}

export type PagedReadOptions = {
  /** Columns to order by. At least one required for a stable total order. */
  orderBy: Array<{ column: string; ascending?: boolean }>
  /** PostgREST select expression. Defaults to '*'. */
  select?: string
  /** Optional filter: column = value pairs applied before paging. */
  filters?: Array<{ column: string; value: unknown }>
  /**
   * When true, throw if the result set is empty. This turns a zero-row read
   * into a hard failure so that a detector requiring non-empty data surfaces
   * the problem instead of silently reporting "ok" with no findings.
   */
  requireNonEmpty?: boolean
}

/**
 * Read every row from a Supabase table, paging in 1,000-row chunks.
 *
 * Throws on any page error (no partial results). Throws when the read
 * exceeds MAX_PAGES to prevent runaway loops.
 */
export async function pagedRead<T>(
  from: { from: (table: string) => PageableQuery<T> },
  table: string,
  options: PagedReadOptions,
): Promise<T[]> {
  const rows: T[] = []
  const selectExpr = options.select ?? '*'
  const filters = options.filters ?? []

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const offset = page * PAGE_SIZE
    let query = from.from(table).select(selectExpr)

    for (const filter of filters) {
      query = query.eq(filter.column, filter.value)
    }

    for (const order of options.orderBy) {
      query = query.order(order.column, { ascending: order.ascending ?? true })
    }

    const { data, error } = await query.range(offset, offset + PAGE_SIZE - 1)

    if (error) {
      throw error
    }

    const pageRows = (data ?? []) as T[]
    rows.push(...pageRows)

    if (pageRows.length < PAGE_SIZE) {
      if (options.requireNonEmpty && rows.length === 0) {
        throw new Error(
          `pagedRead: table "${table}" returned zero rows but requireNonEmpty was set`,
        )
      }
      return rows
    }
  }

  throw new Error(
    `pagedRead: table "${table}" did not terminate after ${MAX_PAGES} pages`,
  )
}
