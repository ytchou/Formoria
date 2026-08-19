import {
  matchSubcategory,
  normalizeSubcategoryKey,
  subcategoryBySlug,
  type L2Subcategory,
} from '@/lib/taxonomy/ontology'

export type RejectedSubcategoryReason = 'unknown-term' | 'empty'

export type NormalizeSubcategoriesResult = {
  /** Stored representation: ontology slugs (DEV-1510). */
  subcategories: string[]
  subcategoriesEn: string[]
  rejected: { subcategory: string; reason: RejectedSubcategoryReason }[]
}

export type SubcategoriesDelta = {
  add: string[]
  remove: string[]
}

export type SubcategorySelectionResult =
  | { ok: true; slug: string; subcategory: L2Subcategory }
  | { ok: false; reason: RejectedSubcategoryReason }

export const MAX_SUBCATEGORIES = 5

// ---------------------------------------------------------------------------
// The rejected-input log
// ---------------------------------------------------------------------------

export type RejectedSubcategoryInput = {
  /** Exactly what was typed or sent, before any normalization. */
  input: string
  /** Which surface produced it — picker, correction validator, enrichment. */
  surface: string
  at: string
}

/**
 * Rejected input is LOGGED, never dropped.
 *
 * Closing the vocabulary removed the only channel through which a missing
 * product kind used to announce itself: before DEV-1510 an unrecognised term
 * survived as a novel subcategory and showed up in the corrections queue. With
 * every free-text path gone, a gap in the 175 nodes is otherwise invisible —
 * the term simply fails to be selectable and nobody ever learns it was wanted.
 * This log is that signal's only replacement, which is why a silent `return`
 * on the reject branch is a defect, not a simplification.
 *
 * Ceiling: an in-memory ring plus a structured `console.warn`, so server-side
 * rejections land in the platform log and client-side ones are readable by the
 * surface that installed a sink. Upgrade path: persist to a `taxonomy_gaps`
 * table and report on it per admission round, once the volume justifies a
 * table.
 */
const REJECTED_LOG_LIMIT = 200
const rejectedInputs: RejectedSubcategoryInput[] = []
let rejectedSink: ((entry: RejectedSubcategoryInput) => void) | null = null

/**
 * Installs a sink that receives every rejection as it happens. `null` restores
 * the default (structured log line only). One sink at a time, deliberately:
 * this is a diagnostic channel, not an event bus.
 */
export function setRejectedSubcategorySink(
  sink: ((entry: RejectedSubcategoryInput) => void) | null,
): void {
  rejectedSink = sink
}

export function recordRejectedSubcategoryInput(entry: {
  input: string
  surface: string
}): RejectedSubcategoryInput {
  const record: RejectedSubcategoryInput = {
    input: entry.input,
    surface: entry.surface,
    at: new Date().toISOString(),
  }

  rejectedInputs.push(record)
  if (rejectedInputs.length > REJECTED_LOG_LIMIT) {
    rejectedInputs.splice(0, rejectedInputs.length - REJECTED_LOG_LIMIT)
  }

  if (rejectedSink) {
    rejectedSink(record)
  } else {
    console.warn(
      `[subcategory-vocabulary-gap] rejected input ${JSON.stringify(record)}`,
    )
  }

  return record
}

export function readRejectedSubcategoryInputs(): readonly RejectedSubcategoryInput[] {
  return [...rejectedInputs]
}

export function clearRejectedSubcategoryInputs(): void {
  rejectedInputs.length = 0
}

/**
 * Every ontology `nameEn` is Title Case ('Rain Boots', 'Clasp-Frame Bags'), so a
 * value the vocabulary does not know that keeps its lowercase spelling ('rain boots')
 * sits next to canonical ones on the same card and reads as a data bug. Capitalizes the
 * first letter of each whitespace-separated word and touches nothing else, so existing
 * capitals survive ('USB-C' stays 'USB-C') and a Chinese fallback is a no-op.
 */
function toSubcategoryTitleCase(value: string): string {
  return value.replace(/(^|\s)(\p{Ll})/gu, (_, lead: string, letter: string) =>
    `${lead}${letter.toLocaleUpperCase()}`,
  )
}

/**
 * Resolves one subcategory a person picked or a model emitted, against the
 * CLOSED vocabulary. Both bases are tried: the stored slug first (DEV-1510
 * storage), then `nameZh` / `nameEn` / aliases, so a pre-migration payload and
 * a freshly picked chip resolve the same way. Anything else is a rejection —
 * there is no novel branch any more.
 *
 * Pure and ontology-only, so a client component can import it for inline
 * feedback and the server can reuse it as the guard.
 */
export function resolveSubcategorySelection(input: string): SubcategorySelectionResult {
  const trimmed = input.trim()
  if (!trimmed) return { ok: false, reason: 'empty' }

  const subcategory = subcategoryBySlug(trimmed) ?? matchSubcategory(trimmed)
  if (!subcategory) return { ok: false, reason: 'unknown-term' }

  return { ok: true, slug: subcategory.slug, subcategory }
}

/**
 * Normalizes a set of subcategory values to STORED SLUGS.
 *
 * Callers hand this either slugs (the picker, the post-DEV-1510 model contract)
 * or zh-TW labels (pre-migration jsonb payloads, a pasted list). Both resolve;
 * anything else is rejected and logged rather than stored, because
 * `brands.subcategories` is a slug column and a free-text value written there
 * renders as a dead filter.
 *
 * There is no English parameter. `subcategoriesEn` is DERIVED from the resolved
 * node (`L2Subcategory.nameEn`), which is what keeps the two arrays
 * index-aligned by construction rather than by a caller's discipline.
 */
export function normalizeSubcategories(
  subcategories: string[],
): NormalizeSubcategoriesResult {
  const pairs: Array<{ slug: string; en: string }> = []
  const rejected: NormalizeSubcategoriesResult['rejected'] = []
  const seenSlugs = new Set<string>()

  const addCanonicalSubcategory = (sub: L2Subcategory): void => {
    if (seenSlugs.has(sub.slug)) return
    seenSlugs.add(sub.slug)
    pairs.push({ slug: sub.slug, en: sub.nameEn })
  }

  for (const rawValue of subcategories) {
    const value = rawValue.trim()
    // A blank entry is a shape problem, not a vocabulary gap — logging it would
    // bury the signal this log exists to carry.
    if (!value) continue

    const resolved = resolveSubcategorySelection(value)
    if (resolved.ok) {
      addCanonicalSubcategory(resolved.subcategory)
      continue
    }

    // An unmatched composite is not a subcategory by itself. Keep the halves
    // that resolve to real nodes; the composite spelling itself is dropped.
    if (value.includes('・')) {
      let resolvedAnyHalf = false
      for (const half of value.split('・')) {
        const halfResolved = resolveSubcategorySelection(half)
        if (halfResolved.ok) {
          addCanonicalSubcategory(halfResolved.subcategory)
          resolvedAnyHalf = true
        }
      }
      if (resolvedAnyHalf) continue
    }

    rejected.push({ subcategory: rawValue, reason: resolved.reason })
    recordRejectedSubcategoryInput({ input: rawValue, surface: 'normalize' })
  }

  const capped = pairs.slice(0, MAX_SUBCATEGORIES)
  return {
    subcategories: capped.map((pair) => pair.slug),
    subcategoriesEn: capped.map((pair) => pair.en),
    rejected,
  }
}

export function deriveCategoryFromSubcategories(
  subcategories: string[],
): L2Subcategory['category'] | null {
  const votes = new Map<L2Subcategory['category'], number>()
  const seenSubcategories = new Set<string>()

  for (const subcategoryValue of subcategories) {
    const resolved = resolveSubcategorySelection(subcategoryValue)
    if (!resolved.ok || seenSubcategories.has(resolved.slug)) continue
    seenSubcategories.add(resolved.slug)
    const { category } = resolved.subcategory
    votes.set(category, (votes.get(category) ?? 0) + 1)
  }

  let winner: L2Subcategory['category'] | null = null
  let winningVotes = 0
  let tied = false

  for (const [category, count] of votes) {
    if (count > winningVotes) {
      winner = category
      winningVotes = count
      tied = false
    } else if (count === winningVotes) {
      tied = true
    }
  }

  return tied ? null : winner
}

/**
 * Derives `subcategories_en` from the stored `subcategories`. `existingEn` is
 * the currently stored EN array, index-aligned, and is only ever a fallback:
 *
 * - A vocabulary hit ALWAYS wins over the stored value. That is what repairs the
 *   drift DEV-1266 found — `backpacks` stored as 'Backpack'/'backpack' becomes the
 *   canonical 'Backpacks'.
 * - A value the vocabulary does not know keeps its stored EN, Title Cased, so a
 *   real human translation ('sling bag') survives as 'Sling Bag' instead of
 *   being thrown away. Since DEV-1510 the write paths cannot create such a
 *   value, but pre-migration rows still carry them.
 *
 * Called with one argument it behaves exactly as before.
 */
export function deriveSubcategoriesEn(
  subcategories: string[],
  existingEn: string[] = [],
): string[] {
  return subcategories.map((subcategory, index) => {
    const resolved = resolveSubcategorySelection(subcategory)
    if (resolved.ok) return resolved.subcategory.nameEn
    return toSubcategoryTitleCase(existingEn[index]?.trim() || subcategory)
  })
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

export function isSubcategoriesDelta(value: unknown): value is SubcategoriesDelta {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return false
  const record = value as Record<string, unknown>
  return isStringArray(record.add) && isStringArray(record.remove)
}

/**
 * Applies a correction delta. Membership — removal and dedupe alike — is keyed
 * by `normalizeSubcategoryKey`, the same basis `matchSubcategory` matches on, so a
 * legacy value stored raw ('Vegan') cannot coexist with a case or full-width
 * variant of itself ('vegan') and burn two of the five cap slots. The string
 * kept is always the FIRST-seen original, never the normalized key: the key is
 * an identity, not a display value.
 */
export function applySubcategoryDelta(
  current: string[],
  delta: SubcategoriesDelta,
): string[] {
  const removed = new Set(delta.remove.map(normalizeSubcategoryKey))
  const seen = new Set<string>()
  const next: string[] = []

  for (const subcategory of current) {
    const key = normalizeSubcategoryKey(subcategory)
    if (removed.has(key) || seen.has(key)) continue
    seen.add(key)
    next.push(subcategory)
  }

  for (const subcategory of delta.add) {
    const key = normalizeSubcategoryKey(subcategory)
    if (seen.has(key)) continue
    seen.add(key)
    next.push(subcategory)
  }

  return next
}

export function sameSubcategorySet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  const rightSet = new Set(right)
  return left.every((subcategory) => rightSet.has(subcategory))
}

