import {
  matchSubcategory,
  normalizeTagKey,
  type ProductSubcategory,
} from '@/lib/taxonomy/ontology'

export type NormalizeProductTagsResult = {
  tags: string[]
  tagsEn: string[]
  rejected: { tag: string; reason: string }[]
  crossBranch: string[]
}

export type ProductTagsDelta = {
  add: string[]
  remove: string[]
}

export type NovelTagRejectionReason = 'length' | 'blocklist'

export type ProductTagInputResult =
  | { ok: true; tag: string; canonical: boolean }
  | { ok: false; reason: NovelTagRejectionReason }

export const MAX_PRODUCT_TAGS = 5
const MIN_NOVEL_LENGTH = 2
const MAX_NOVEL_LENGTH = 8

// Reject tags whose content signals a promotional/variant/series label
const BLOCKLIST_CONTENT = /系列|限定|聯名|客製|訂製|優惠|折扣|禮盒組|組合|款$/u

// Reject tags that open with a size/scale qualifier — too generic to be a product type
const BLOCKLIST_SIZE_PREFIX = /^(超|迷你|小|大|長|短)/u

/**
 * The single novel-tag gate: a tag that misses the ontology is only kept when
 * this returns `null`. Both callers live in this module — the enrichment writer
 * (`normalizeProductTags`) and the visitor-facing correction validator
 * (`resolveProductTagInput`) — so the two can never drift. The `export` exists
 * for the unit test.
 * Expects an already-trimmed tag.
 */
export function novelTagRejection(tag: string): NovelTagRejectionReason | null {
  // Code points, not `.length`: `String.prototype.length` counts UTF-16 code
  // units, so one astral character (an emoji) would score 2 and clear the min,
  // and four would score 8 and clear the max — the exact input the band exists
  // to exclude.
  const length = [...tag].length
  if (length < MIN_NOVEL_LENGTH || length > MAX_NOVEL_LENGTH) {
    return 'length'
  }
  if (BLOCKLIST_CONTENT.test(tag) || BLOCKLIST_SIZE_PREFIX.test(tag)) {
    return 'blocklist'
  }
  return null
}

/**
 * Every ontology `nameEn` is Title Case ('Rain Boots', 'Clasp-Frame Bags'), so a
 * novel tag that keeps the model's lowercase output ('rain boots') sits next to
 * canonical ones on the same card and reads as a data bug. Capitalizes the first
 * letter of each whitespace-separated word and touches nothing else, so existing
 * capitals survive ('USB-C' stays 'USB-C') and a Chinese fallback is a no-op.
 * Casing only — this does NOT drop or machine-translate the tag, which
 * `docs/decisions/2026-07-27-correction-novel-tag-escape-hatch.md` rules out.
 */
function toTagTitleCase(value: string): string {
  return value.replace(/(^|\s)(\p{Ll})/gu, (_, lead: string, letter: string) =>
    `${lead}${letter.toLocaleUpperCase()}`,
  )
}

/**
 * Resolves one free-text tag a person typed. An ontology hit (nameZh, nameEn or
 * any alias) is canonicalized to its nameZh; a miss is accepted as-is when it
 * clears `novelTagRejection`. Pure and ontology-only, so a client component can
 * import it for inline feedback and the server can reuse it as the guard.
 * `matchSubcategory` already NFKC-normalizes, so no extra normalization here.
 */
export function resolveProductTagInput(input: string): ProductTagInputResult {
  const trimmed = input.trim()

  const sub = matchSubcategory(trimmed)
  if (sub) return { ok: true, tag: sub.nameZh, canonical: true }

  const rejection = novelTagRejection(trimmed)
  if (rejection) return { ok: false, reason: rejection }

  return { ok: true, tag: trimmed, canonical: false }
}

export function normalizeProductTags(
  tags: string[],
  tagsEn: string[],
  brandCategory?: string,
): NormalizeProductTagsResult {
  const pairs: Array<{ zh: string; en: string }> = []
  const rejected: { tag: string; reason: string }[] = []
  const crossBranch: string[] = []
  const seenSlugs = new Set<string>()

  for (let i = 0; i < tags.length; i++) {
    const rawZh = tags[i]
    const rawEn = tagsEn[i] ?? ''
    const zh = rawZh.trim()
    const en = rawEn.trim()

    const sub = matchSubcategory(zh)
    if (sub) {
      // Vocab match — dedupe by slug, first occurrence wins
      if (seenSlugs.has(sub.slug)) continue
      seenSlugs.add(sub.slug)
      pairs.push({ zh: sub.nameZh, en: sub.nameEn })
      if (brandCategory !== undefined && sub.category !== brandCategory) {
        crossBranch.push(sub.nameZh)
      }
    } else {
      // Novel tag heuristics
      const rejection = novelTagRejection(zh)
      if (rejection) {
        rejected.push({ tag: rawZh, reason: rejection })
      } else {
        pairs.push({ zh, en: toTagTitleCase(en || zh) })
      }
    }
  }

  const capped = pairs.slice(0, MAX_PRODUCT_TAGS)
  return {
    tags: capped.map((p) => p.zh),
    tagsEn: capped.map((p) => p.en),
    rejected,
    crossBranch,
  }
}

export function deriveProductTypeFromTags(
  tags: string[],
): ProductSubcategory['category'] | null {
  const votes = new Map<ProductSubcategory['category'], number>()
  const seenSubcategories = new Set<string>()

  for (const tag of tags) {
    const subcategory = matchSubcategory(tag)
    if (!subcategory || seenSubcategories.has(subcategory.slug)) continue
    seenSubcategories.add(subcategory.slug)
    votes.set(subcategory.category, (votes.get(subcategory.category) ?? 0) + 1)
  }

  let winner: ProductSubcategory['category'] | null = null
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
 * Derives `product_tags_en` from `product_tags`. `existingEn` is the currently
 * stored EN array, index-aligned with `tags`, and is only ever a fallback:
 *
 * - An ontology hit ALWAYS wins over the stored value. That is what repairs the
 *   drift DEV-1266 found — `後背包` stored as 'Backpack'/'backpack' becomes the
 *   canonical 'Backpacks', `面膜` becomes 'Face Masks'.
 * - A novel tag (ontology miss) keeps its stored EN, Title Cased, so a real
 *   human/LLM translation ('sling bag') survives as 'Sling Bag' instead of
 *   being thrown away.
 *
 * Called with one argument it behaves exactly as before.
 *
 * ACCEPTED TRADEOFF, not a bug: when `existingEn` has nothing for a novel tag,
 * the raw (usually Chinese) string is written to `product_tags_en` verbatim and
 * renders untranslated on `/en`. `docs/decisions/2026-07-27-correction-novel-tag-escape-hatch.md`
 * weighs this against the alternatives and takes it deliberately — do not
 * "fix" it by dropping the tag or machine-translating it here.
 */
export function deriveProductTagsEn(
  tags: string[],
  existingEn: string[] = [],
): string[] {
  return tags.map((tag, index) => {
    const canonical = matchSubcategory(tag)?.nameEn
    if (canonical) return canonical
    return toTagTitleCase(existingEn[index]?.trim() || tag)
  })
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

export function isProductTagsDelta(value: unknown): value is ProductTagsDelta {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return false
  const record = value as Record<string, unknown>
  return isStringArray(record.add) && isStringArray(record.remove)
}

/**
 * Applies a correction delta. Membership — removal and dedupe alike — is keyed
 * by `normalizeTagKey`, the same basis `matchSubcategory` matches on, so a
 * novel tag stored raw ('Vegan') cannot coexist with a case or full-width
 * variant of itself ('vegan') and burn two of the five cap slots. The string
 * kept is always the FIRST-seen original, never the normalized key: the key is
 * an identity, not a display value.
 */
export function applyTagDelta(
  current: string[],
  delta: ProductTagsDelta,
): string[] {
  const removed = new Set(delta.remove.map(normalizeTagKey))
  const seen = new Set<string>()
  const next: string[] = []

  for (const tag of current) {
    const key = normalizeTagKey(tag)
    if (removed.has(key) || seen.has(key)) continue
    seen.add(key)
    next.push(tag)
  }

  for (const tag of delta.add) {
    const key = normalizeTagKey(tag)
    if (seen.has(key)) continue
    seen.add(key)
    next.push(tag)
  }

  return next
}

export function sameTagSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  const rightSet = new Set(right)
  return left.every((tag) => rightSet.has(tag))
}

type TagBackfillMatch = {
  original: string
  canonicalZh: string
  canonicalEn: string
  slug: string
}

export type TagBackfillPlan = {
  matched: TagBackfillMatch[]
  unmatched: string[]
}

/**
 * Deterministic first pass for the normalize-product-tags backfill.
 * Tags that hit the ontology vocab are resolved to canonical zh/en/slug.
 * Tags that miss are returned as `unmatched` for LLM follow-up.
 * Deduplication is by slug — first occurrence wins.
 */
export function planTagBackfill(tags: string[]): TagBackfillPlan {
  const matched: TagBackfillMatch[] = []
  const unmatched: string[] = []
  const seenSlugs = new Set<string>()

  for (const tag of tags) {
    const sub = matchSubcategory(tag)
    if (sub) {
      if (seenSlugs.has(sub.slug)) continue
      seenSlugs.add(sub.slug)
      matched.push({
        original: tag,
        canonicalZh: sub.nameZh,
        canonicalEn: sub.nameEn,
        slug: sub.slug,
      })
    } else {
      unmatched.push(tag)
    }
  }

  return { matched, unmatched }
}
