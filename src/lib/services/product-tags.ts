import { matchSubcategory } from '@/lib/taxonomy/ontology'

export type NormalizeProductTagsResult = {
  tags: string[]
  tagsEn: string[]
  rejected: { tag: string; reason: string }[]
  crossBranch: string[]
}

const MAX_TAGS = 5
const MIN_NOVEL_LENGTH = 2
const MAX_NOVEL_LENGTH = 8

// Reject tags whose content signals a promotional/variant/series label
const BLOCKLIST_CONTENT = /系列|限定|聯名|客製|訂製|優惠|折扣|禮盒組|組合|款$/u

// Reject tags that open with a size/scale qualifier — too generic to be a product type
const BLOCKLIST_SIZE_PREFIX = /^(超|迷你|小|大|長|短)/u

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
      if (zh.length < MIN_NOVEL_LENGTH || zh.length > MAX_NOVEL_LENGTH) {
        rejected.push({ tag: rawZh, reason: 'length' })
      } else if (BLOCKLIST_CONTENT.test(zh) || BLOCKLIST_SIZE_PREFIX.test(zh)) {
        rejected.push({ tag: rawZh, reason: 'blocklist' })
      } else {
        pairs.push({ zh, en: en || zh })
      }
    }
  }

  const capped = pairs.slice(0, MAX_TAGS)
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

export type TagBackfillMatch = {
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
