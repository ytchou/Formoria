/**
 * DEV-1568 — is every rendered `brand_images` row actually servable?
 *
 * DEV-1551 moved brand imagery onto the same-origin `/i/<storage_path>` proxy,
 * which downloads from the DEPLOYING project's own bucket. That made two
 * previously harmless states fatal, and both are invisible to the type system
 * and to every existing test:
 *
 *   1. The row's key names no object in this project's bucket. Staging was
 *      seeded with rows copied from production and no bytes at all, so every
 *      gallery rendered blank while `imagePathToUrl` stayed correct and its
 *      unit tests stayed green.
 *   2. The row's key sits under a `PRIVATE_IMAGE_PREFIXES` entry. The proxy
 *      refuses those unconditionally, so the image 404s even when the bytes
 *      are present. 4,088 of production's 7,911 rows were in this state when
 *      measured on 2026-08-23.
 *
 * Both are the same defect wearing different clothes — "a row the page renders
 * points at something the proxy will not serve" — so they are one report with
 * one pass/fail.
 *
 * Deliberately dependency-free, like `submission-image-promotion.ts`: the rule
 * is exercised with plain row objects and a plain key set, because this repo
 * forbids mocking Supabase and has no database-backed tests. The live half —
 * reading the rows and listing the bucket — belongs to
 * `scripts/check-image-resolvability.ts`.
 */
import { PRIVATE_IMAGE_PREFIXES } from './image-proxy'

/** A `brand_images` row reduced to what resolvability depends on. */
export type ResolvabilityRow = {
  id: string
  storagePath: string | null | undefined
}

type UnresolvableReason =
  /** The key names no object in this project's bucket. The bytes are missing. */
  | 'missing-object'
  /** The key is deny-listed by the read proxy. The bytes are irrelevant. */
  | 'private-prefix'

type UnresolvableImage = {
  id: string
  storagePath: string
  reason: UnresolvableReason
}

export type ResolvabilityReport = {
  scanned: number
  resolvable: number
  /**
   * Rows carrying no key at all. Reported, not failed: a row can legitimately
   * hold no object (`brand-images` maintenance nulls the path when an image is
   * rejected), and the proxy is not involved either way.
   */
  withoutStoragePath: number
  unresolvable: UnresolvableImage[]
  counts: Record<UnresolvableReason, number>
}

function trimmed(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const candidate = value.trim()
  return candidate.length > 0 ? candidate : null
}

/** True when the read proxy refuses this key on its prefix alone. */
export function isPrivateStorageKey(key: string): boolean {
  return PRIVATE_IMAGE_PREFIXES.some((prefix) => key.startsWith(prefix))
}

/**
 * Judges each row against the keys the bucket actually holds.
 *
 * `objectKeys` is the authoritative inventory for the SAME project the rows
 * came from. Passing production's rows and staging's inventory would report
 * every row as missing, which is true of that pairing and useless as a fact
 * about either project — the caller owns keeping the two halves together.
 *
 * The private-prefix verdict wins over the missing-object one: the bytes being
 * present changes nothing while the proxy refuses the prefix, and reporting
 * such a row as "missing" would send the reader to copy objects that are
 * already there.
 */
export function planImageResolvability(
  rows: readonly ResolvabilityRow[],
  objectKeys: ReadonlySet<string>,
): ResolvabilityReport {
  const unresolvable: UnresolvableImage[] = []
  const counts: Record<UnresolvableReason, number> = {
    'missing-object': 0,
    'private-prefix': 0,
  }
  let resolvable = 0
  let withoutStoragePath = 0

  for (const row of rows) {
    const key = trimmed(row.storagePath)
    if (key === null) {
      withoutStoragePath += 1
      continue
    }
    const reason: UnresolvableReason | null = isPrivateStorageKey(key)
      ? 'private-prefix'
      : objectKeys.has(key)
        ? null
        : 'missing-object'
    if (reason === null) {
      resolvable += 1
      continue
    }
    counts[reason] += 1
    unresolvable.push({ id: row.id, storagePath: key, reason })
  }

  return {
    scanned: rows.length,
    resolvable,
    withoutStoragePath,
    unresolvable,
    counts,
  }
}

/** The single question a health check asks: is anything unservable? */
export function isFullyResolvable(report: ResolvabilityReport): boolean {
  return report.unresolvable.length === 0
}
