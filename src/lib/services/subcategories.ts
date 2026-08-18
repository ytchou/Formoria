import {
  isRetiredCompositeLabel,
  matchSubcategory,
  normalizeSubcategoryKey,
  type L2Subcategory,
} from '@/lib/taxonomy/ontology'

export type NormalizeSubcategoriesResult = {
  subcategories: string[]
  subcategoriesEn: string[]
  rejected: { subcategory: string; reason: string }[]
  crossBranch: string[]
}

export type SubcategoriesDelta = {
  add: string[]
  remove: string[]
}

export type NovelSubcategoryRejectionReason = 'length' | 'blocklist' | 'retired-composite'

export type SubcategoryInputResult =
  | { ok: true; subcategory: string; canonical: boolean }
  | { ok: false; reason: NovelSubcategoryRejectionReason }

export const MAX_SUBCATEGORIES = 5
const MIN_NOVEL_LENGTH = 2
const MAX_NOVEL_LENGTH = 8

// Reject subcategories whose content signals a promotional/variant/series label
const BLOCKLIST_CONTENT = /系列|限定|聯名|客製|訂製|優惠|折扣|禮盒組|組合|款$/u

// Reject subcategories that open with a size/scale qualifier — too generic to be a product category
const BLOCKLIST_SIZE_PREFIX = /^(超|迷你|小|大|長|短)/u

/**
 * The single novel-subcategory gate: a subcategory that misses the ontology is only kept when
 * this returns `null`. Both callers live in this module — the enrichment writer
 * (`normalizeSubcategories`) and the visitor-facing correction validator
 * (`resolveSubcategoryInput`) — so the two can never drift. The `export` exists
 * for the unit test.
 * Expects an already-trimmed subcategory.
 */
export function novelSubcategoryRejection(subcategory: string): NovelSubcategoryRejectionReason | null {
  if (isRetiredCompositeLabel(subcategory)) return 'retired-composite'

  // Code points, not `.length`: `String.prototype.length` counts UTF-16 code
  // units, so one astral character (an emoji) would score 2 and clear the min,
  // and four would score 8 and clear the max — the exact input the band exists
  // to exclude.
  const length = [...subcategory].length
  if (length < MIN_NOVEL_LENGTH || length > MAX_NOVEL_LENGTH) {
    return 'length'
  }
  if (BLOCKLIST_CONTENT.test(subcategory) || BLOCKLIST_SIZE_PREFIX.test(subcategory)) {
    return 'blocklist'
  }
  return null
}

/**
 * Every ontology `nameEn` is Title Case ('Rain Boots', 'Clasp-Frame Bags'), so a
 * novel subcategory that keeps the model's lowercase output ('rain boots') sits next to
 * canonical ones on the same card and reads as a data bug. Capitalizes the first
 * letter of each whitespace-separated word and touches nothing else, so existing
 * capitals survive ('USB-C' stays 'USB-C') and a Chinese fallback is a no-op.
 * Casing only — this does NOT drop or machine-translate the subcategory, which
 * `docs/decisions/2026-07-27-correction-novel-tag-escape-hatch.md` rules out.
 */
function toSubcategoryTitleCase(value: string): string {
  return value.replace(/(^|\s)(\p{Ll})/gu, (_, lead: string, letter: string) =>
    `${lead}${letter.toLocaleUpperCase()}`,
  )
}

/**
 * Resolves one free-text subcategory a person typed. An ontology hit (nameZh, nameEn or
 * any alias) is canonicalized to its nameZh; a miss is accepted as-is when it
 * clears `novelSubcategoryRejection`. Pure and ontology-only, so a client component can
 * import it for inline feedback and the server can reuse it as the guard.
 * `matchSubcategory` already NFKC-normalizes, so no extra normalization here.
 */
export function resolveSubcategoryInput(input: string): SubcategoryInputResult {
  const trimmed = input.trim()

  const sub = matchSubcategory(trimmed)
  if (sub) return { ok: true, subcategory: sub.nameZh, canonical: true }

  // Canonical ontology matching always wins first (for example, the accepted
  // 卡片・明信片 synonym). Retired DEV-1361 composites are then blocked from
  // the novel-subcategory escape hatch, including their compact no-dot spellings.
  if (isRetiredCompositeLabel(trimmed)) {
    return { ok: false, reason: 'retired-composite' }
  }

  const rejection = novelSubcategoryRejection(trimmed)
  if (rejection) return { ok: false, reason: rejection }

  return { ok: true, subcategory: trimmed, canonical: false }
}

export function normalizeSubcategories(
  subcategories: string[],
  subcategoriesEn: string[],
  categorySlug?: string,
): NormalizeSubcategoriesResult {
  const pairs: Array<{ zh: string; en: string }> = []
  const rejected: { subcategory: string; reason: string }[] = []
  const crossBranch: string[] = []
  const seenSlugs = new Set<string>()

  const addCanonicalSubcategory = (sub: L2Subcategory): void => {
    // Vocab match — dedupe by slug, first occurrence wins
    if (seenSlugs.has(sub.slug)) return
    seenSlugs.add(sub.slug)
    pairs.push({ zh: sub.nameZh, en: sub.nameEn })
    if (categorySlug !== undefined && sub.category !== categorySlug) {
      crossBranch.push(sub.nameZh)
    }
  }

  for (let i = 0; i < subcategories.length; i++) {
    const rawZh = subcategories[i]
    const rawEn = subcategoriesEn[i] ?? ''
    const zh = rawZh.trim()
    const en = rawEn.trim()

    const sub = matchSubcategory(zh)
    if (sub) {
      addCanonicalSubcategory(sub)
    } else {
      if (isRetiredCompositeLabel(zh)) {
        rejected.push({ subcategory: rawZh, reason: 'retired-composite' })
        continue
      }

      // An unmatched composite is not a subcategory by itself. Keep only
      // halves that resolve to canonical ontology subcategories; unresolved halves and
      // the original composite must not become novel subcategories.
      if (zh.includes('・')) {
        for (const half of zh.split('・')) {
          const halfSub = matchSubcategory(half.trim())
          if (halfSub) addCanonicalSubcategory(halfSub)
        }
        continue
      }

      // Novel subcategory heuristics
      const rejection = novelSubcategoryRejection(zh)
      if (rejection) {
        rejected.push({ subcategory: rawZh, reason: rejection })
      } else {
        pairs.push({ zh, en: toSubcategoryTitleCase(en || zh) })
      }
    }
  }

  const capped = pairs.slice(0, MAX_SUBCATEGORIES)
  return {
    subcategories: capped.map((p) => p.zh),
    subcategoriesEn: capped.map((p) => p.en),
    rejected,
    crossBranch,
  }
}

export function deriveCategoryFromSubcategories(
  subcategories: string[],
): L2Subcategory['category'] | null {
  const votes = new Map<L2Subcategory['category'], number>()
  const seenSubcategories = new Set<string>()

  for (const subcategoryValue of subcategories) {
    const subcategory = matchSubcategory(subcategoryValue)
    if (!subcategory || seenSubcategories.has(subcategory.slug)) continue
    seenSubcategories.add(subcategory.slug)
    votes.set(subcategory.category, (votes.get(subcategory.category) ?? 0) + 1)
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
 * Derives `subcategories_en` from `subcategories`. `existingEn` is the currently
 * stored EN array, index-aligned with `subcategories`, and is only ever a fallback:
 *
 * - An ontology hit ALWAYS wins over the stored value. That is what repairs the
 *   drift DEV-1266 found — `後背包` stored as 'Backpack'/'backpack' becomes the
 *   canonical 'Backpacks', `面膜` becomes 'Face Masks'.
 * - A novel subcategory (ontology miss) keeps its stored EN, Title Cased, so a real
 *   human/LLM translation ('sling bag') survives as 'Sling Bag' instead of
 *   being thrown away.
 *
 * Called with one argument it behaves exactly as before.
 *
 * ACCEPTED TRADEOFF, not a bug: when `existingEn` has nothing for a novel subcategory,
 * the raw (usually Chinese) string is written to `subcategories_en` verbatim and
 * renders untranslated on `/en`. `docs/decisions/2026-07-27-correction-novel-tag-escape-hatch.md`
 * weighs this against the alternatives and takes it deliberately — do not
 * "fix" it by dropping the subcategory or machine-translating it here.
 */
export function deriveSubcategoriesEn(
  subcategories: string[],
  existingEn: string[] = [],
): string[] {
  return subcategories.map((subcategory, index) => {
    const canonical = matchSubcategory(subcategory)?.nameEn
    if (canonical) return canonical
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
 * novel subcategory stored raw ('Vegan') cannot coexist with a case or full-width
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

type SubcategoryBackfillMatch = {
  original: string
  canonicalZh: string
  canonicalEn: string
  slug: string
}

export type SubcategoryBackfillPlan = {
  matched: SubcategoryBackfillMatch[]
  unmatched: string[]
}

/**
 * Deterministic first pass for the normalize-subcategories backfill.
 * Subcategories that hit the ontology vocab are resolved to canonical zh/en/slug.
 * Subcategories that miss are returned as `unmatched` for LLM follow-up.
 * Deduplication is by slug — first occurrence wins.
 */
export function planSubcategoryBackfill(subcategories: string[]): SubcategoryBackfillPlan {
  const matched: SubcategoryBackfillMatch[] = []
  const unmatched: string[] = []
  const seenSlugs = new Set<string>()

  for (const subcategory of subcategories) {
    const sub = matchSubcategory(subcategory)
    if (sub) {
      if (seenSlugs.has(sub.slug)) continue
      seenSlugs.add(sub.slug)
      matched.push({
        original: subcategory,
        canonicalZh: sub.nameZh,
        canonicalEn: sub.nameEn,
        slug: sub.slug,
      })
    } else {
      unmatched.push(subcategory)
    }
  }

  return { matched, unmatched }
}
