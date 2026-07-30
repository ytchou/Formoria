import fs from 'fs'
import path from 'path'

import { describe, expect, it } from 'vitest'

import { describeWithDb } from '@/test/setup'
import { extractBrandSlugs } from '@/lib/mdx/extract-brand-slugs'
import { getBrandsBySlugs } from '../brands'

/**
 * Guard on the brand slugs authors embed in story MDX.
 *
 * Extraction is `extractBrandSlugs` — the same function the story detail page
 * counts its `view_item_list` with. A second copy of the patterns here is what
 * let the two drift apart (this file had no `<BrandSpotlight>` case at all while
 * the page did), so the guard and the page now pass or fail together.
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

/** Mirrors the shape `brands.slug` is generated in: ASCII kebab-case, 3–80 chars. */
const BRAND_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{2,79}$/

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
    return extractBrandSlugs(raw).map(slug => ({ file, slug }))
  })
}

describe('story content brand slugs', () => {
  // Unconditional: a CJK or otherwise malformed slug must fail CI even with no
  // database credentials present. No round trip is needed to spot one.
  it('every content slug matches the brand slug pattern', () => {
    for (const { file, slug } of readStorySlugReferences()) {
      expect(
        BRAND_SLUG_PATTERN.test(slug),
        `${file}: "${slug}" is not a valid brand slug — expected ASCII kebab-case matching ${String(BRAND_SLUG_PATTERN)}`,
      ).toBe(true)
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
    expect(BRAND_SLUG_PATTERN.test('測試品牌')).toBe(false)
    // The valid neighbour still passes, so the guard fails on the offender only.
    expect(BRAND_SLUG_PATTERN.test('kiln-studio')).toBe(true)
  })

  it('covers every brand shortcode, including BrandSpotlight and BrandGrid', () => {
    const source = [
      '<BrandCard slug="molasses" />',
      '',
      '<BrandSpotlight slug="yingge-kiln">',
      '',
      'The kiln has run since 1974.',
      '',
      '</BrandSpotlight>',
      '',
      // `notes` before `slugs`, with a `>` inside a note value: a naive
      // `[^>]*?` prefix stops at that `>` and drops the whole grid.
      '<BrandGrid notes={{ "tainan-soy": "2020 > 2024" }} slugs={["tainan-soy", "paper-mill"]} />',
    ].join('\n')

    expect(extractBrandSlugs(source)).toEqual([
      'molasses',
      'yingge-kiln',
      'tainan-soy',
      'paper-mill',
    ])
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
})

describeWithDb('story content brand slugs (live lookup)', () => {
  it('every BrandCard slug resolves to an approved brand', async () => {
    const references = readStorySlugReferences()
    const slugs = [...new Set(references.map(reference => reference.slug))]
    if (slugs.length === 0) return

    const brands = await getBrandsBySlugs(slugs)
    const unresolved = references
      .filter(reference => !brands.has(reference.slug))
      .map(reference => `${reference.file}: "${reference.slug}"`)

    expect(
      unresolved,
      `story slugs with no approved brand:\n${unresolved.join('\n')}`,
    ).toEqual([])
  })
})
