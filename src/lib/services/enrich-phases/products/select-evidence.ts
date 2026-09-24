/**
 * Relevance-aware product-page evidence selection (DEV-1855).
 *
 * Pure: no I/O, never throws. Label regexes live in `evidence-lexicon.ts`;
 * this file must stay free of Han characters (CJK guard), so comments name
 * lexicon symbols instead of quoting their values.
 */

import { CHROME_PATTERN, FACT_TIERS, TEMPLATE_TOKEN_PATTERN } from './evidence-lexicon'

/** Per-page character budget for the text sent to the propose prompt. */
export const MAX_MAIN_TEXT_CHARS = 4096
/** Approximate size of the always-kept lead (first non-chrome blocks). */
export const LEAD_CHARS = 600
/** A block shorter than this is never treated as a cross-page repeat. */
export const REPEAT_MIN_CHARS = 120
/** A repeat must appear on at least this many pages... */
export const REPEAT_MIN_PAGES = 3
/** ...and on at least this share of the pages that carry blocks. */
export const REPEAT_MIN_SHARE = 0.5

export type TextStats = {
  /** Length of the unfiltered text, `blocks.join(' ')`. */
  fullChars: number
  /** Length of the emitted `mainText`. */
  includedChars: number
  /** Chars removed as template tokens, chrome, or cross-page repeats. */
  boilerplateChars: number
  /** `true` when non-boilerplate content was left out for budget. */
  truncated: boolean
}

export type SelectPageTextOptions = {
  /** Repeat keys (see `repeatKey`) to drop, computed by `selectAcrossPages`. */
  repeated?: ReadonlySet<string>
}

const SEPARATOR = ' '

function stripTokens(block: string): string {
  return block.replace(TEMPLATE_TOKEN_PATTERN, '').replace(/\s+/g, ' ').trim()
}

/** Cross-page identity of a block: NFKC with collapsed whitespace. */
function repeatKey(cleaned: string): string {
  return cleaned.normalize('NFKC').replace(/\s+/g, ' ').trim()
}

/** Index into `FACT_TIERS` of the first matching tier, or -1. */
function factTierIndex(text: string): number {
  return FACT_TIERS.findIndex(({ pattern }) => pattern.test(text))
}

type Candidate = { index: number; text: string; tier: number }

/**
 * Selects the most useful text from one page's blocks within
 * `MAX_MAIN_TEXT_CHARS`: lead, then fact tiers in `FACT_TIERS` order, then the
 * rest. Kept blocks are emitted in document order.
 */
export function selectPageText(
  blocks: readonly string[],
  opts: SelectPageTextOptions = {},
): { mainText: string; textStats: TextStats } {
  const unfiltered = blocks.join(SEPARATOR)
  const fullChars = unfiltered.length
  if (blocks.length === 0) {
    return {
      mainText: '',
      textStats: { fullChars: 0, includedChars: 0, boilerplateChars: 0, truncated: false },
    }
  }

  const candidates: Candidate[] = []
  let boilerplateChars = 0
  blocks.forEach((raw, index) => {
    const text = stripTokens(raw)
    const tier = text ? factTierIndex(text) : -1
    const isChrome = text !== '' && tier === -1 && CHROME_PATTERN.test(text)
    const isRepeat =
      text !== '' && opts.repeated !== undefined && opts.repeated.has(repeatKey(text))
    if (text === '' || isChrome || isRepeat) {
      boilerplateChars += raw.length
      return
    }
    boilerplateChars += raw.length - raw.replace(TEMPLATE_TOKEN_PATTERN, '').length
    candidates.push({ index, text, tier })
  })

  // Safety net: heuristics must never empty a page. Every block was chrome,
  // repeated or token-only, so fall back to the unfiltered prefix.
  if (candidates.length === 0) {
    const mainText = unfiltered.slice(0, MAX_MAIN_TEXT_CHARS)
    return {
      mainText,
      textStats: {
        fullChars,
        includedChars: mainText.length,
        boilerplateChars: 0,
        truncated: fullChars > mainText.length,
      },
    }
  }

  const kept = new Set<number>()
  let used = 0
  // Adds a candidate if it fits; the separator before it counts toward budget.
  const tryAdd = (c: Candidate): boolean => {
    if (kept.has(c.index)) return true
    const cost = c.text.length + (kept.size > 0 ? SEPARATOR.length : 0)
    if (used + cost > MAX_MAIN_TEXT_CHARS) return false
    kept.add(c.index)
    used += cost
    return true
  }

  // 1. Lead: the first candidate, then following ones while within LEAD_CHARS.
  let leadChars = 0
  for (const c of candidates) {
    if (leadChars > 0 && leadChars + c.text.length > LEAD_CHARS) break
    if (!tryAdd(c)) break
    leadChars += c.text.length
  }

  // 2. Fact tiers in priority order, document order within a tier.
  for (let tier = 0; tier < FACT_TIERS.length; tier++) {
    for (const c of candidates) if (c.tier === tier) tryAdd(c)
  }

  // 3. Remaining body in document order.
  for (const c of candidates) tryAdd(c)

  // Last resort: nothing fit whole, so slice the first candidate.
  const first = candidates[0]
  if (kept.size === 0 && first) {
    const mainText = first.text.slice(0, MAX_MAIN_TEXT_CHARS)
    return {
      mainText,
      textStats: { fullChars, includedChars: mainText.length, boilerplateChars, truncated: true },
    }
  }

  const mainText = candidates
    .filter((c) => kept.has(c.index))
    .map((c) => c.text)
    .join(SEPARATOR)
  return {
    mainText,
    textStats: {
      fullChars,
      includedChars: mainText.length,
      boilerplateChars,
      truncated: kept.size < candidates.length,
    },
  }
}

type SelectableEvidence = {
  mainText: string
  blocks?: string[]
  textStats?: TextStats
}

/**
 * Re-runs `selectPageText` on every page that carries `blocks`, dropping long
 * blocks repeated across the brand's pages (`REPEAT_MIN_CHARS`,
 * `REPEAT_MIN_PAGES`, `REPEAT_MIN_SHARE`). Returned pages never carry
 * `blocks`; pages without `blocks` (recorded evidence, fixtures) pass through
 * with their `mainText` unchanged.
 */
export function selectAcrossPages<T extends SelectableEvidence>(
  pages: readonly T[],
): Array<Omit<T, 'blocks'>> {
  const pageCounts = new Map<string, number>()
  let pagesWithBlocks = 0
  for (const p of pages) {
    if (!p.blocks) continue
    pagesWithBlocks++
    const seen = new Set<string>()
    for (const raw of p.blocks) {
      const key = repeatKey(stripTokens(raw))
      if (key.length < REPEAT_MIN_CHARS || seen.has(key)) continue
      seen.add(key)
      pageCounts.set(key, (pageCounts.get(key) ?? 0) + 1)
    }
  }

  const repeated = new Set<string>()
  for (const [key, count] of pageCounts) {
    if (count >= REPEAT_MIN_PAGES && count >= REPEAT_MIN_SHARE * pagesWithBlocks) {
      repeated.add(key)
    }
  }

  return pages.map((p) => {
    if (!('blocks' in p)) return p as Omit<T, 'blocks'>
    const { blocks, ...rest } = p
    if (!blocks) return rest as Omit<T, 'blocks'>
    const { mainText, textStats } = selectPageText(blocks, { repeated })
    return { ...rest, mainText, textStats } as Omit<T, 'blocks'>
  })
}
