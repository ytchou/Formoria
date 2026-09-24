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
/**
 * A fact-less block matching `CHROME_PATTERN` is dropped as boilerplate only
 * up to this length (cleaned text). Longer ones are real prose that mentions
 * a chrome word in passing; they are kept but ranked last.
 */
export const CHROME_MAX_CHARS = 60
/**
 * A fact-tier block this short (cleaned text) is a bare label, e.g. a line
 * ending in a colon before a br; the block after it carries the value.
 */
export const LABEL_MAX_CHARS = 24

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

/** Removes template tokens; reports the cleaned text and the chars removed. */
function stripTokens(block: string): { text: string; tokenChars: number } {
  const withoutTokens = block.replace(TEMPLATE_TOKEN_PATTERN, '')
  return {
    text: withoutTokens.replace(/\s+/g, ' ').trim(),
    tokenChars: block.length - withoutTokens.length,
  }
}

/** Cross-page identity of a block: NFKC with collapsed whitespace. */
function repeatKey(cleaned: string): string {
  return cleaned.normalize('NFKC').replace(/\s+/g, ' ').trim()
}

/** First `n` UTF-16 units, backing off one unit rather than split a surrogate pair. */
function sliceSafe(text: string, n: number): string {
  if (n <= 0) return ''
  if (n >= text.length) return text
  const last = text.charCodeAt(n - 1)
  return text.slice(0, last >= 0xd800 && last <= 0xdbff ? n - 1 : n)
}

/** Index into `FACT_TIERS` of the first matching tier, or -1. */
function factTierIndex(text: string): number {
  return FACT_TIERS.findIndex(({ pattern }) => pattern.test(text))
}

type Candidate = {
  index: number
  text: string
  tier: number
  /** Long fact-less block matching `CHROME_PATTERN`: kept, but ranked last. */
  chrome: boolean
}

/**
 * Selects the most useful text from one page's blocks within
 * `MAX_MAIN_TEXT_CHARS`: lead, then fact tiers in `FACT_TIERS` order (a short
 * label travels with the block after it), then the rest, then long
 * chrome-word blocks. If budget remains, one block that did not fit whole is
 * sliced into it. Kept blocks are emitted in document order.
 *
 * Trade-off: short chrome-word blocks are dropped even when they are the
 * page heading. No special case; the heading rarely carries product facts.
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
    const { text, tokenChars } = stripTokens(raw)
    const tier = text ? factTierIndex(text) : -1
    const chromeWord = text !== '' && tier === -1 && CHROME_PATTERN.test(text)
    const isShortChrome = chromeWord && text.length <= CHROME_MAX_CHARS
    // A repeated block that carries a fact label is brand-wide product fact
    // (shared material or care copy), not boilerplate, so it stays on every page.
    const isRepeat =
      text !== '' &&
      tier === -1 &&
      opts.repeated !== undefined &&
      opts.repeated.has(repeatKey(text))
    if (text === '' || isShortChrome || isRepeat) {
      boilerplateChars += raw.length
      return
    }
    boilerplateChars += tokenChars
    candidates.push({ index, text, tier, chrome: chromeWord })
  })

  // Safety net: heuristics must never empty a page. Every block was chrome,
  // repeated or token-only, so fall back to the unfiltered prefix.
  if (candidates.length === 0) {
    const mainText = sliceSafe(unfiltered, MAX_MAIN_TEXT_CHARS)
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

  // Candidate index -> emitted text; shorter than the candidate when sliced.
  const kept = new Map<number, string>()
  let used = 0
  const separatorCost = () => (kept.size > 0 ? SEPARATOR.length : 0)
  // Adds a candidate whole if it fits; the separator before it counts toward budget.
  const tryAdd = (c: Candidate): boolean => {
    if (kept.has(c.index)) return kept.get(c.index) === c.text
    const cost = c.text.length + separatorCost()
    if (used + cost > MAX_MAIN_TEXT_CHARS) return false
    kept.set(c.index, c.text)
    used += cost
    return true
  }

  // 1. Lead: the first candidate, then following ones while within LEAD_CHARS.
  // A first candidate too large to fit whole is kept sliced to LEAD_CHARS.
  let leadChars = 0
  for (const c of candidates) {
    if (leadChars > 0 && leadChars + c.text.length > LEAD_CHARS) break
    if (!tryAdd(c)) {
      if (leadChars === 0) {
        const slice = sliceSafe(c.text, LEAD_CHARS)
        kept.set(c.index, slice)
        used += slice.length
      }
      break
    }
    leadChars += c.text.length
  }

  // 2. Fact tiers in priority order, document order within a tier. A kept
  // short label keeps the next candidate (its value) at the same priority.
  for (let tier = 0; tier < FACT_TIERS.length; tier++) {
    candidates.forEach((c, pos) => {
      if (c.tier !== tier || !tryAdd(c) || c.text.length > LABEL_MAX_CHARS) return
      const value = candidates[pos + 1]
      if (value && !value.chrome) tryAdd(value)
    })
  }

  // 3. Remaining body in document order, then long chrome-word blocks.
  for (const c of candidates) if (!c.chrome) tryAdd(c)
  for (const c of candidates) if (c.chrome) tryAdd(c)

  // 4. Fill leftover budget with a slice of the first candidate, in document
  // order, that is not kept whole. At most one block is sliced here.
  const partial = candidates.find((c) => kept.get(c.index) !== c.text)
  if (partial) {
    const current = kept.get(partial.index)
    const room = MAX_MAIN_TEXT_CHARS - used - (current === undefined ? separatorCost() : 0)
    const slice = sliceSafe(partial.text, (current?.length ?? 0) + room)
    if (slice.length > (current?.length ?? 0)) {
      if (current === undefined) used += separatorCost()
      used += slice.length - (current?.length ?? 0)
      kept.set(partial.index, slice)
    }
  }

  const emitted = candidates.filter((c) => kept.has(c.index))
  const mainText = emitted.map((c) => kept.get(c.index)).join(SEPARATOR)
  return {
    mainText,
    textStats: {
      fullChars,
      includedChars: mainText.length,
      boilerplateChars,
      truncated: candidates.some((c) => kept.get(c.index) !== c.text),
    },
  }
}

type SelectableEvidence = {
  mainText: string
  url?: string
  blocks?: string[]
  textStats?: TextStats
}

/**
 * Re-runs `selectPageText` on every page that carries `blocks`, dropping long
 * blocks repeated across the brand's pages (`REPEAT_MIN_CHARS`,
 * `REPEAT_MIN_PAGES`, `REPEAT_MIN_SHARE`) unless they match a fact tier. Only pages with at least one block
 * count, and pages sharing a `url` count once, so duplicate reads of one page
 * never look like a site-wide repeat. Returned pages never carry `blocks`;
 * pages without `blocks` (recorded evidence, fixtures) pass through with their
 * `mainText` unchanged.
 */
export function selectAcrossPages<T extends SelectableEvidence>(
  pages: readonly T[],
): Array<Omit<T, 'blocks'>> {
  const pageCounts = new Map<string, number>()
  const countedUrls = new Set<string>()
  let pagesWithBlocks = 0
  for (const p of pages) {
    if (!p.blocks || p.blocks.length === 0) continue
    if (typeof p.url === 'string') {
      if (countedUrls.has(p.url)) continue
      countedUrls.add(p.url)
    }
    pagesWithBlocks++
    const seen = new Set<string>()
    for (const raw of p.blocks) {
      const key = repeatKey(stripTokens(raw).text)
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
    const { blocks, ...rest } = p
    if (!blocks) return rest as Omit<T, 'blocks'>
    const { mainText, textStats } = selectPageText(blocks, { repeated })
    return { ...rest, mainText, textStats } as Omit<T, 'blocks'>
  })
}
