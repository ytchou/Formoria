/**
 * Shared CLI and read helpers for the curated-product scripts (DEV-1404).
 *
 * `check-links.ts` is the remaining entry point onto the curated-product
 * tables; these helpers stay in their own module so the CLI surface
 * (`--brand` parsing, the revalidation preflight, paged reads) is testable
 * without the script's Supabase wiring.
 *
 * PURE-ISH BY DESIGN: no Supabase client is imported here. `fetchAllRows` takes
 * the page fetcher as a callback, so the caller owns the client and this module
 * stays testable without one.
 */

/** Supabase's default `db-max-rows`. A read that does not page stops here. */
const SUPABASE_PAGE_SIZE = 1000

/** Dry run is the default: `--apply` is the only thing that writes. */
export function parseApplyOption(argv: readonly string[]): boolean {
  return argv.includes('--apply')
}

/**
 * `--csv=<path>` or `--csv <path>`. Returns null when absent, throws on empty.
 */
export function parseCsvPath(argv: readonly string[]): string | null {
  const csvArg = argv.find((arg) => arg.startsWith('--csv='))
  const csvIndex = argv.indexOf('--csv')
  const csv = csvArg
    ? csvArg.slice('--csv='.length)
    : csvIndex === -1
      ? null
      : (argv.at(csvIndex + 1) ?? null)
  if (csv !== null && (!csv || csv.startsWith('--'))) {
    throw new Error('--csv requires a file path')
  }
  return csv
}

/**
 * `--slugs=a,b,c` or `--slugs a,b,c`. Returns null when absent, throws on empty.
 */
export function parseSlugsOption(argv: readonly string[]): string[] | null {
  const slugsArg = argv.find((arg) => arg.startsWith('--slugs='))
  const slugsIndex = argv.indexOf('--slugs')
  const raw = slugsArg
    ? slugsArg.slice('--slugs='.length)
    : slugsIndex === -1
      ? null
      : (argv.at(slugsIndex + 1) ?? null)
  if (raw !== null && (!raw || raw.startsWith('--'))) {
    throw new Error('--slugs requires a comma-separated list')
  }
  if (raw === null) return null
  const slugs = raw.split(',').map((s) => s.trim()).filter(Boolean)
  if (slugs.length === 0) throw new Error('--slugs requires at least one slug')
  return slugs
}

/**
 * `--brand=<slug>` or `--brand <slug>`. Returns null when the flag is absent
 * and throws when it is present but empty — a silent null there would process
 * EVERY brand from a command the operator wrote to scope one.
 */
export function parseBrandOption(argv: string[]): string | null {
  const brandArg = argv.find((arg) => arg.startsWith('--brand='))
  const brandIndex = argv.indexOf('--brand')
  const brand = brandArg
    ? brandArg.slice('--brand='.length)
    : brandIndex === -1
      ? null
      : (argv.at(brandIndex + 1) ?? null)
  if (brand !== null && (!brand || brand.startsWith('--'))) {
    throw new Error('--brand requires a brand slug')
  }
  return brand
}

/**
 * Revalidation config is checked BEFORE the first write, not after the last
 * one. The revalidate client warns and skips when it is unconfigured, which for
 * these scripts would mean a run that reports success while every touched brand
 * page keeps serving its hour-old shell. Failing here leaves the database
 * untouched, which is the reversible failure.
 */
export function assertRevalidationConfigured(): void {
  const hasOrigin = Boolean(
    process.env.FORMORIA_RAILWAY_URL?.trim() ||
      process.env.NEXT_PUBLIC_SITE_URL?.trim(),
  )
  const hasSecret = Boolean(process.env.ORIGIN_SECRET?.trim())
  if (hasOrigin && hasSecret) return

  throw new Error(
    '--apply requires ORIGIN_SECRET and FORMORIA_RAILWAY_URL (or NEXT_PUBLIC_SITE_URL): ' +
      'without them the write lands but every brand page keeps serving the stale ISR shell',
  )
}

type PageResult = { data: unknown[] | null; error: { message: string } | null }

/**
 * Reads every row of a PostgREST query, one `.range()` page at a time.
 *
 * A single unpaged `select()` silently truncates at Supabase's `db-max-rows`
 * (1000 by default) — no error, no warning. That is worse than a crash: a row
 * outside the first page is invisible to the caller, so a dead link on it is
 * never probed and the product keeps advertising a call-to-action that 404s.
 *
 * The page fetcher MUST apply a stable `.order()`, or two pages can return the
 * same row and miss another. Mirrors `fetchAllRows` in
 * scripts/brand-storage-maintenance.ts.
 */
export async function fetchAllRows<T>(
  label: string,
  fetchPage: (from: number, to: number) => PromiseLike<PageResult>,
  pageSize: number = SUPABASE_PAGE_SIZE,
): Promise<T[]> {
  const rows: T[] = []
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await fetchPage(offset, offset + pageSize - 1)
    if (error) throw new Error(`failed to read ${label}: ${error.message}`)
    const page = (data ?? []) as T[]
    rows.push(...page)
    if (page.length < pageSize) break
  }
  return rows
}
