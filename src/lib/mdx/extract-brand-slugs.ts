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
 * missing a shortcode pattern entirely, so a story using only that shortcode
 * was counted for analytics but never slug-checked.
 */

/**
 * `<BrandCard slug="…">` and `<BrandLine slug="…">`, including the ones nested
 * inside a `<BrandRow>` or `<BrandList>`: neither wrapper carries slugs of its
 * own, so their children match here unchanged.
 *
 * `BrandLine` belongs in this alternation for exactly the reason in the file
 * header — a shortcode missing from this parser is a brand that is invisible to
 * the CI slug guard, and whose clicks fire `select_item` against a
 * `view_item_list` that never counted it.
 *
 * The prop prefix is `[\s\S]*?`, not `[^>]*?`: an earlier prop *value* may
 * legally contain a `>` (`note="a > b"`), and a `>`-excluding prefix makes the
 * whole shortcode fail to match — the referenced brand then goes invisible to
 * both the CI slug guard and the analytics count. The `\bslug=["']` anchor that
 * follows is what stops the non-greedy prefix from running past the shortcode.
 */
const SINGLE_SLUG_SHORTCODE = /<(?:BrandCard|BrandLine)\b[\s\S]*?\bslug=["']([^"']*)["']/g
/**
 * `<BrandGallery slug="…">` — slug-bearing like the two above, but deliberately
 * kept out of `SINGLE_SLUG_SHORTCODE` because it renders photographs, not links.
 * It must be slug-checked by CI (an unresolvable slug there is a silently
 * imageless section), yet it can never produce a `select_item`, so counting it
 * toward `view_item_list` would report impressions for items no one can click.
 * Hence the split: `extractBrandSlugs` sees it, `extractLinkedBrandSlugs` does not.
 */
const GALLERY_SLUG_SHORTCODE = /<BrandGallery\b[\s\S]*?\bslug=["']([^"']*)["']/g
/** `<BrandGrid slugs={[ "…", "…" ]}>` — the array body is captured, then split. */
const GRID_SLUGS_SHORTCODE = /<BrandGrid\b[\s\S]*?\bslugs=\{\s*\[([\s\S]*?)\]\s*\}/g
const QUOTED_ENTRY = /["']([^"']*)["']/g

/**
 * A prose markdown link into the brand directory: `[brand name](/brands/ziliaoshi)`.
 *
 * Deliberately absent from both shortcode extractors above, for opposite
 * reasons. It stays out of `extractLinkedBrandSlugs` because that sizes the
 * story page's `view_item_list`, and only a rendered card can fire a matching
 * `select_item` — counting prose links there reports impressions against
 * something GA4 will never see clicked. It stays out of `extractBrandSlugs`
 * because that is the shortcode parser, and folding a markdown pattern into it
 * would make its name a lie.
 *
 * It still has to be checked. A prose link is the one brand reference with no
 * runtime safety net: every shortcode resolves through `getBrandsBySlugs` and
 * degrades to a visible placeholder when a slug is dead, whereas a bad prose
 * link is a plain `<a>` that 404s in production with nothing logged. The CI
 * guard therefore checks the union of this and `extractBrandSlugs`.
 *
 * A trailing segment (`/brands/foo/bar`), a query, or a hash is not matched,
 * because none of those is a brand detail URL — the route is `/brands/[slug]`
 * exactly, and `/brands?category=home` has no slug at all. Locale prefixes are
 * absent by convention: story links are locale-relative and middleware resolves
 * them.
 */
const PROSE_BRAND_LINK = /\]\(\/brands\/([^)\s/?#]*)\)/g

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
 * included — callers that want a unique set build one.
 *
 * This is the CI slug guard's view: it must cover every shortcode that names a
 * brand, linked or not. For the analytics-facing subset use
 * `extractLinkedBrandSlugs`.
 */
export function extractBrandSlugs(source: string): string[] {
  return collectBrandSlugs(source, true)
}

/**
 * Only the slugs a reader can actually click through to a brand page. This is
 * what the detail page's `view_item_list` count is built from — an impression
 * for an item with no `select_item` path is noise in GA4, not a datapoint.
 */
export function extractLinkedBrandSlugs(source: string): string[] {
  return collectBrandSlugs(source, false)
}

/**
 * Every brand slug referenced by a prose markdown link, in document order,
 * duplicates included. Fenced blocks are stripped for the same reason as above:
 * a story documenting the link syntax is not referencing a real brand.
 *
 * Separate from both shortcode extractors on purpose — see `PROSE_BRAND_LINK`.
 */
export function extractProseBrandSlugs(source: string): string[] {
  return [...stripFencedCodeBlocks(source).matchAll(PROSE_BRAND_LINK)].map(match => match[1])
}

function collectBrandSlugs(source: string, includeGallery: boolean): string[] {
  const body = stripFencedCodeBlocks(source)
  const found: Array<{ index: number; slug: string }> = []

  for (const match of body.matchAll(SINGLE_SLUG_SHORTCODE)) {
    found.push({ index: match.index ?? 0, slug: match[1] })
  }

  if (includeGallery) {
    for (const match of body.matchAll(GALLERY_SLUG_SHORTCODE)) {
      found.push({ index: match.index ?? 0, slug: match[1] })
    }
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
