/**
 * Shared types for weekly link-check classes.
 */

import type { HealthFinding } from '@/lib/services/health-agent/contracts'

// ---------------------------------------------------------------------------
// Common result shape returned by every link-check class
// ---------------------------------------------------------------------------

export type LinkCheckClassResult = {
  checked: number
  dead: number
  blocked: number
  findings: HealthFinding[]
  /** Set when the class itself failed (e.g. zero rows from a required table). */
  error?: string
}

// ---------------------------------------------------------------------------
// Supabase DI seams — narrowest shapes for test doubles
// ---------------------------------------------------------------------------

/**
 * Minimal Supabase query builder — enough for pagedRead + `.in()`.
 * Matches the `PageableQuery` shape from `paged-read.ts` plus `.in()`.
 */
type LinkCheckQuery = {
  select: (columns: string) => LinkCheckQuery
  order: (column: string, options?: { ascending: boolean }) => LinkCheckQuery
  range: (
    from: number,
    to: number,
  ) => Promise<{ data: unknown[] | null; error: unknown }>
  eq: (column: string, value: unknown) => LinkCheckQuery
  neq: (column: string, value: unknown) => LinkCheckQuery
  in: (column: string, values: unknown[]) => LinkCheckQuery
  is: (column: string, value: unknown) => LinkCheckQuery
  not: (column: string, operator: string, value: unknown) => LinkCheckQuery
}

export type LinkCheckClient = {
  from: (table: string) => LinkCheckQuery
}

/**
 * Write-only client shape for classes that update rows (curated-products).
 */
export type LinkCheckWriter = {
  from: (table: string) => {
    update: (values: Record<string, unknown>) => {
      eq: (
        column: string,
        value: string,
      ) => Promise<{ error: { message: string } | null }>
    }
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max ids per PostgREST `.in()` filter. Mirrors link-health.ts. */
export const IN_FILTER_CHUNK_SIZE = 200

/** Concurrency for outbound URL checks. */
export const LINK_CHECK_CONCURRENCY = 5

/** Maximum dead links surfaced per finding to keep evidence readable. */
export const MAX_DEAD_LINKS_PER_FINDING = 50
