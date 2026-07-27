import { matchSubcategory } from '@/lib/taxonomy/ontology'

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
 * this returns `null`. Shared by the enrichment writers and by the visitor-facing
 * correction validator so the two can never drift.
 * Expects an already-trimmed tag.
 */
export function novelTagRejection(tag: string): NovelTagRejectionReason | null {
  if (tag.length < MIN_NOVEL_LENGTH || tag.length > MAX_NOVEL_LENGTH) {
    return 'length'
  }
  if (BLOCKLIST_CONTENT.test(tag) || BLOCKLIST_SIZE_PREFIX.test(tag)) {
    return 'blocklist'
  }
  return null
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
        pairs.push({ zh, en: en || zh })
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

export function deriveProductTagsEn(tags: string[]): string[] {
  return tags.map((tag) => matchSubcategory(tag)?.nameEn ?? tag)
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

export function applyTagDelta(
  current: string[],
  delta: ProductTagsDelta,
): string[] {
  const removed = new Set(delta.remove)
  const seen = new Set<string>()
  const next: string[] = []

  for (const tag of current) {
    if (removed.has(tag) || seen.has(tag)) continue
    seen.add(tag)
    next.push(tag)
  }

  for (const tag of delta.add) {
    if (seen.has(tag)) continue
    seen.add(tag)
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
