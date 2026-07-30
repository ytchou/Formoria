/**
 * The single parser for brand slugs referenced by story MDX shortcodes.
 *
 * Raw-text extraction on purpose: it must run with no MDX toolchain and no
 * database, which is what lets the CI guard suite check every authored slug
 * against the brand table (and against the slug pattern) without compiling
 * anything.
 *
 * It replaces two hand-rolled copies that had already drifted — the detail
 * page's analytics counter and the content guard test — where the guard was
 * missing a `BrandSpotlight` pattern entirely, so a spotlight-only story was
 * counted for analytics but never slug-checked.
 */

/**
 * `<BrandCard slug="…">` and `<BrandSpotlight slug="…">`
 *
 * The prop prefix is `[\s\S]*?`, not `[^>]*?`: an earlier prop *value* may
 * legally contain a `>` (`note="a > b"`), and a `>`-excluding prefix makes the
 * whole shortcode fail to match — the referenced brand then goes invisible to
 * both the CI slug guard and the analytics count. The `\bslug=["']` anchor that
 * follows is what stops the non-greedy prefix from running past the shortcode.
 */
const SINGLE_SLUG_SHORTCODE = /<(?:BrandCard|BrandSpotlight)\b[\s\S]*?\bslug=["']([^"']*)["']/g
/** `<BrandGrid slugs={[ "…", "…" ]}>` — the array body is captured, then split. */
const GRID_SLUGS_SHORTCODE = /<BrandGrid\b[\s\S]*?\bslugs=\{\s*\[([\s\S]*?)\]\s*\}/g
const QUOTED_ENTRY = /["']([^"']*)["']/g

/** Opening or closing fence: up to three leading spaces, then ``` or ~~~. */
const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})/

/**
 * Drops fenced code blocks so a story *documenting* the shortcode syntax does
 * not get its examples counted as real brand references.
 *
 * Line-scanning rather than a regex with a backreference: fences nest by type,
 * and a `~~~` block may legally contain ``` lines. A fence left unclosed at EOF
 * swallows the rest of the file, which is the safe direction — an unterminated
 * block is malformed content, and under-counting beats inventing references.
 */
function stripFencedCodeBlocks(source: string): string {
  const kept: string[] = []
  let openFence: string | null = null

  for (const line of source.split('\n')) {
    const fence = FENCE_LINE.exec(line)?.[1]

    if (openFence === null) {
      if (fence) {
        openFence = fence[0]
        continue
      }
      kept.push(line)
    } else if (fence && fence[0] === openFence) {
      openFence = null
    }
    // Any other line inside an open fence is dropped.
  }

  return kept.join('\n')
}

/**
 * Every brand slug the source references, in document order, duplicates
 * included — callers that want a unique set build one, and the analytics
 * counter genuinely wants the raw reference count.
 */
export function extractBrandSlugs(source: string): string[] {
  const body = stripFencedCodeBlocks(source)
  const found: Array<{ index: number; slug: string }> = []

  for (const match of body.matchAll(SINGLE_SLUG_SHORTCODE)) {
    found.push({ index: match.index ?? 0, slug: match[1] })
  }

  for (const grid of body.matchAll(GRID_SLUGS_SHORTCODE)) {
    // Offset of the captured array body inside the whole match, so grid entries
    // interleave with single shortcodes at their true document position.
    const arrayStart = (grid.index ?? 0) + grid[0].indexOf(grid[1])
    for (const entry of grid[1].matchAll(QUOTED_ENTRY)) {
      found.push({ index: arrayStart + (entry.index ?? 0), slug: entry[1] })
    }
  }

  return found.sort((a, b) => a.index - b.index).map(item => item.slug)
}
