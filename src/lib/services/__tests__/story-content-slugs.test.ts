import fs from 'fs'
import path from 'path'

import { describe, expect, it } from 'vitest'

import {
  extractBrandSlugs,
  extractLinkedBrandSlugs,
  extractProseBrandSlugs,
  stripFencedCodeBlocks,
} from '@/lib/mdx/extract-brand-slugs'
import { isValidSlug } from '../brands'

/**
 * Guard on the brand slugs authors embed in story MDX.
 *
 * Extraction is `extractBrandSlugs` — the same function the story detail page
 * counts its `view_item_list` with. A second copy of the patterns here is what
 * let the two drift apart (this file was missing a shortcode case the page
 * matched), so the guard and the page now pass or fail together.
 *
 * The real-content scan reads files off disk on purpose — it must never mock
 * `fs`, and it must never compile MDX: raw-text extraction is what lets the
 * pattern check run in CI with no database and no MDX toolchain. The sibling
 * suite `src/lib/taxonomy/__tests__/story-tags.test.ts` reads content the same way.
 *
 * That scan is vacuous while `content/stories/` holds only `.gitkeep`, so the
 * fixture cases below carry the guard until real stories land. Its reason for
 * existing is the class of bug it catches early: the deleted example guides
 * embedded CJK brand names where a kebab-case slug belongs, which surfaced only
 * as an empty placeholder card at render time.
 */

const STORIES_DIR = path.join(process.cwd(), 'content', 'stories')

/**
 * The rule comes from `isValidSlug`, the brand layer's own definition — this
 * file deliberately does NOT restate it. It used to, as `{2,79}`, which was
 * stricter than the real rule (`{0,79}`) and rejected legitimate one- and
 * two-character slugs like `y` (郁郁 YùYù) and `ng` (雱PĀNG). A story should
 * accept whatever slug the directory holds; slug shape is the brand layer's
 * concern, not the story's.
 */

type SlugReference = { file: string; slug: string }

function readStorySlugReferences(): SlugReference[] {
  let files: string[]
  try {
    files = fs.readdirSync(STORIES_DIR).filter(file => file.endsWith('.mdx'))
  } catch {
    return []
  }

  return files.flatMap(file => {
    const raw = fs.readFileSync(path.join(STORIES_DIR, file), 'utf8')
    // Union, not just the shortcodes: a prose `[名](/brands/slug)` link is the
    // one brand reference with no runtime fallback, so a typo there ships a 404
    // rather than a placeholder card. See `PROSE_BRAND_LINK`.
    return [...extractBrandSlugs(raw), ...extractProseBrandSlugs(raw)].map(slug => ({ file, slug }))
  })
}

/**
 * Brands a published story may reference: every slug was `status = approved` in
 * a read-only production query on 2026-10-08.
 *
 * A fixture, not a lookup, because tests cannot reach a database in this repo:
 * the DB-backed suites were removed on 2026-08-21, and mocking Supabase is
 * forbidden by `scripts/check-test-boundaries.mjs`. A story that adds a brand
 * must add its slug here after confirming the brand is `approved` — a hidden
 * brand drops out of `getPublicBrandsBySlugs`, and its card vanishes from the
 * published page (DEV-1963: huiaio-studio, essence-design-craft, yuwu-design
 * and mountopia are hidden and deliberately absent).
 *
 * Ceiling: this catches a story written against a brand that is not approved,
 * not a brand hidden after the story shipped. That case is caught only by the
 * dev/staging `MissingBrandNotice`. Upgrade path: a DB-backed check against the
 * brand table once a test database exists (see CLAUDE.md, "no DB-backed tests").
 */
const APPROVED_STORY_BRAND_SLUGS: ReadonlySet<string> = new Set([
  'ziliaoshi',
  'b-610-asteroid-b-610',
  'tings-aroma',
  'tan-nichi',
  'laoshan-collector',
  'yarn-ball',
  'yuyu',
  'mr-eggplants',
  'take-a-snooze',
  'pang',
  'taluma',
  'zenu',
  'simply-made',
  'shiye',
  'goodglas',
  'taiwan-dye',
])

/**
 * Route prefixes that are parked: they redirect to `/` (DEV-1605 redirects in
 * `next.config.ts`), so a story link into one sends the reader to the homepage
 * instead of the page the sentence promises.
 */
const PARKED_ROUTE_PREFIXES = ['/events'] as const

/**
 * A storage key under `brand-images/submissions/`, as a full URL or a bare key.
 * Approved brands' images were promoted to `brands/<id>/`; the `submissions/`
 * objects are private or removed and return 400, so a story embedding one
 * ships a broken image.
 */
const SUBMISSION_IMAGE_KEY = /brand-images\/submissions\/|src=["']submissions\//

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * A markdown link target or `href` into a parked prefix, with or without a
 * locale segment. The trailing lookahead keeps `/events` from matching a
 * sibling route that merely starts with the same letters.
 */
const PARKED_ROUTE_LINK = new RegExp(
  `(?:\\]\\(|href=["'])(?:/(?:en|zh-TW))?(?:${PARKED_ROUTE_PREFIXES.map(escapeRegExp).join('|')})(?=[/?#)"'\\s]|$)`,
  'g',
)

function findUnapprovedSlugs(raw: string): string[] {
  return [...extractBrandSlugs(raw), ...extractProseBrandSlugs(raw)].filter(
    slug => !APPROVED_STORY_BRAND_SLUGS.has(slug),
  )
}

function hasSubmissionImageKey(raw: string): boolean {
  return SUBMISSION_IMAGE_KEY.test(raw)
}

/** Fenced blocks are stripped like the slug extractors do: examples are not links. */
function findParkedRouteLinks(raw: string): string[] {
  return [...stripFencedCodeBlocks(raw).matchAll(PARKED_ROUTE_LINK)].map(match => match[0])
}

function readStorySources(): Array<{ file: string; raw: string }> {
  let files: string[]
  try {
    files = fs.readdirSync(STORIES_DIR).filter(file => file.endsWith('.mdx'))
  } catch {
    return []
  }

  return files.map(file => ({ file, raw: fs.readFileSync(path.join(STORIES_DIR, file), 'utf8') }))
}

describe('story content brand slugs', () => {
  // Unconditional: a CJK or otherwise malformed slug must fail CI even with no
  // database credentials present. No round trip is needed to spot one.
  it('every content slug is a valid brand slug', () => {
    for (const { file, slug } of readStorySlugReferences()) {
      expect(
        isValidSlug(slug),
        `${file}: "${slug}" is not a valid brand slug — expected ASCII kebab-case, per isValidSlug in @/lib/services/brands`,
      ).toBe(true)
    }
  })

  it('every content slug is an approved brand', () => {
    for (const { file, raw } of readStorySources()) {
      expect(
        findUnapprovedSlugs(raw),
        `${file}: references brands not in APPROVED_STORY_BRAND_SLUGS — confirm each is approved, then add it`,
      ).toEqual([])
    }
  })

  it('no story embeds an image from the private submissions/ prefix', () => {
    for (const { file, raw } of readStorySources()) {
      expect(
        hasSubmissionImageKey(raw),
        `${file}: uses a brand-images/submissions/ key — use the promoted brands/<id>/ URL`,
      ).toBe(false)
    }
  })

  it('no story links into a parked route', () => {
    for (const { file, raw } of readStorySources()) {
      expect(
        findParkedRouteLinks(raw),
        `${file}: links into a parked route (${PARKED_ROUTE_PREFIXES.join(', ')}) that redirects to /`,
      ).toEqual([])
    }
  })
})

/**
 * Fixtures, not disk. These are what make the guard fail today: with an empty
 * `content/stories/` the scan above iterates nothing and asserts nothing, so a
 * typo in the extractor would silently disarm it until the first expo PR — the
 * exact PR the guard exists to protect.
 *
 * CJK literals are fine here: `no-hardcoded-cjk` excludes test files, and the
 * whole point of the first case is a slug an author typed as a brand's Chinese
 * name instead of its kebab-case slug.
 */
describe('story content brand slugs (fixture coverage)', () => {
  it('flags a CJK brand name written where a kebab-case slug belongs', () => {
    const source = [
      '# 台北陶器',
      '',
      '<BrandCard slug="測試品牌" note="窯燒的日用碗" />',
      '',
      '<BrandCard slug="kiln-studio" />',
    ].join('\n')

    const slugs = extractBrandSlugs(source)

    expect(slugs).toContain('測試品牌')
    expect(isValidSlug('測試品牌')).toBe(false)
    // The valid neighbour still passes, so the guard fails on the offender only.
    expect(isValidSlug('kiln-studio')).toBe(true)
  })

  it('covers every brand shortcode, including cards nested in BrandRow and BrandGrid', () => {
    const source = [
      '<BrandCard slug="molasses" />',
      '',
      // A row carries no slugs of its own — its child cards must still count.
      '<BrandRow>',
      '',
      '<BrandCard slug="yingge-kiln" note="The kiln has run since 1974." />',
      '',
      '</BrandRow>',
      '',
      // `BrandLine` is the compact list row. It links to a brand exactly like a
      // card does, so it must feed both this guard and the story page's
      // `view_item_list` count — a shortcode the extractor cannot see is a
      // brand that silently escapes the CI check and under-reports analytics.
      '<BrandList>',
      '',
      '<BrandLine slug="paper-mill-line" booth="K3-014" note="Booth is a string." />',
      '',
      '</BrandList>',
      '',
      // Guards the word boundary: a longer tag starting with the same prefix
      // must NOT match.
      '<BrandLineFoo slug="not-a-real-shortcode" />',
      '',
      // `notes` before `slugs`, with a `>` inside a note value: a naive
      // `[^>]*?` prefix stops at that `>` and drops the whole grid.
      '<BrandGrid notes={{ "tainan-soy": "2020 > 2024" }} slugs={["tainan-soy", "paper-mill"]} />',
    ].join('\n')

    expect(extractBrandSlugs(source)).toEqual([
      'molasses',
      'yingge-kiln',
      'paper-mill-line',
      'tainan-soy',
      'paper-mill',
    ])
  })

  // `BrandGallery` renders a brand's photos with no link out, so the two
  // extractors deliberately disagree about it: CI must still validate the slug
  // (an unresolvable one is a silently imageless section), while the story
  // page's `view_item_list` must not report an impression no one can click.
  it('counts BrandGallery for the slug guard but not for the linked-brand count', () => {
    const source = [
      '<BrandCard slug="molasses" />',
      '',
      '<BrandGallery slug="yingge-kiln" caption="圖：鶯歌窯" />',
    ].join('\n')

    expect(extractBrandSlugs(source)).toEqual(['molasses', 'yingge-kiln'])
    expect(extractLinkedBrandSlugs(source)).toEqual(['molasses'])
  })

  it('reads prose brand links separately from the shortcodes', () => {
    const source = [
      '走一趟 [織療室](/brands/ziliaoshi) 的攤位，看看他們怎麼處理布邊。',
      '',
      // Not a brand detail URL: the filtered directory view has no slug.
      '想看更多可以去 [居家生活](/brands?category=home)。',
      '',
      // Nor is a deeper path — the route is `/brands/[slug]` exactly.
      '[不是品牌頁](/brands/ziliaoshi/products)',
      '',
      '<BrandCard slug="molasses" />',
    ].join('\n')

    expect(extractProseBrandSlugs(source)).toEqual(['ziliaoshi'])
    // The two views stay disjoint: prose links must never reach the analytics
    // count, and the shortcode parser must not start matching markdown.
    expect(extractBrandSlugs(source)).toEqual(['molasses'])
    expect(extractLinkedBrandSlugs(source)).toEqual(['molasses'])
  })

  it('ignores prose brand links inside fenced code blocks', () => {
    const source = ['```md', '[範例](/brands/不是真的品牌)', '```'].join('\n')

    expect(extractProseBrandSlugs(source)).toEqual([])
  })

  it('ignores shortcodes inside fenced code blocks', () => {
    const source = [
      'Authors embed brands like this:',
      '',
      '```mdx',
      '<BrandCard slug="不是真的品牌" />',
      '<BrandGrid slugs={["also-not-real"]} />',
      '```',
      '',
      '<BrandCard slug="molasses" />',
    ].join('\n')

    // A syntax example is documentation, not a rendered card: counting it would
    // fail the pattern guard on prose and inflate the story's `view_item_list`.
    expect(extractBrandSlugs(source)).toEqual(['molasses'])
  })

  it('reports a slug missing from the approved list', () => {
    const source = [
      '<BrandCard slug="ziliaoshi" />',
      '',
      '<BrandList>',
      '<BrandLine slug="huiaio-studio" booth="A-1" />',
      '<BrandLine name="無官網的小店" booth="A-2" />',
      '</BrandList>',
      '',
      '[山之境](/brands/mountopia)',
    ].join('\n')

    // The name-only line contributes no slug; both hidden brands are reported.
    expect(findUnapprovedSlugs(source)).toEqual(['huiaio-studio', 'mountopia'])
    expect(findUnapprovedSlugs('<BrandCard slug="ziliaoshi" />')).toEqual([])
  })

  it('a name-only BrandLine yields no slug and does not borrow the next one', () => {
    const source = [
      '<BrandLine name="無官網的小店" booth="A-2" />',
      '<BrandGallery slug="taluma" />',
    ].join('\n')

    expect(extractBrandSlugs(source)).toEqual(['taluma'])
    // The gallery stays out of the linked count — an unbounded prop prefix
    // would have read it as the BrandLine's slug.
    expect(extractLinkedBrandSlugs(source)).toEqual([])
  })

  it('flags an image under brand-images/submissions/', () => {
    const bad = [
      '![攤位](https://example.supabase.co/storage/v1/object/public/brand-images/submissions/abc/1.jpg)',
      '<Figure src="submissions/abc/2.jpg" alt="攤位" />',
    ]
    for (const source of bad) expect(hasSubmissionImageKey(source)).toBe(true)

    expect(
      hasSubmissionImageKey(
        '<Figure src="https://example.supabase.co/storage/v1/object/public/brand-images/brands/id-1/1.jpg" alt="攤位" />',
      ),
    ).toBe(false)
  })

  it('flags links into a parked route, with or without a locale', () => {
    const source = [
      '[展會資訊](/events/2026-creative-expo)',
      '[活動](/en/events)',
      '[活動](/zh-TW/events?tab=map)',
      '<a href="/events/expo">展會</a>',
    ].join('\n')

    expect(findParkedRouteLinks(source)).toHaveLength(4)
  })

  it('passes ordinary links, look-alike routes, and fenced examples', () => {
    const source = [
      '[品牌](/brands/ziliaoshi)',
      '[專題](/stories/expo-guide)',
      '[不是停用的路徑](/events-archive)',
      '```md',
      '[範例](/events/expo)',
      '```',
    ].join('\n')

    expect(findParkedRouteLinks(source)).toEqual([])
  })
})
