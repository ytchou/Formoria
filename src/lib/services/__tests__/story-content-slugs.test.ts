import fs from 'fs'
import path from 'path'

import { describe, expect, it } from 'vitest'

import { describeWithDb } from '@/test/setup'
import { getBrandsBySlugs } from '../brands'

/**
 * Guard on the brand slugs authors embed in story MDX.
 *
 * This suite reads real files off disk on purpose — it must never mock `fs`,
 * and it must never compile MDX: raw-text extraction is what lets the pattern
 * check run in CI with no database and no MDX toolchain. The sibling suite
 * `src/lib/taxonomy/__tests__/story-tags.test.ts` reads content the same way.
 *
 * Vacuous while `content/stories/` holds only `.gitkeep`; it becomes
 * load-bearing the moment the first expo story lands. Its reason for existing
 * is the class of bug it catches early: the deleted example guides embedded
 * CJK brand names where a kebab-case slug belongs, which surfaced only as an
 * empty placeholder card at render time.
 */

const STORIES_DIR = path.join(process.cwd(), 'content', 'stories')

/** Mirrors the shape `brands.slug` is generated in: ASCII kebab-case, 3–80 chars. */
const BRAND_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{2,79}$/

/** `<BrandCard slug="…" />` */
const BRAND_CARD_SLUG = /<BrandCard\b[^>]*?\bslug=["']([^"']*)["']/g
/** `<BrandGrid slugs={[ "…", "…" ]} />` — the array body is captured, then split. */
const BRAND_GRID_SLUGS = /<BrandGrid\b[^>]*?\bslugs=\{\s*\[([\s\S]*?)\]\s*\}/g
const QUOTED_ENTRY = /["']([^"']*)["']/g

type SlugReference = { file: string; slug: string }

function readStorySlugReferences(): SlugReference[] {
  let files: string[]
  try {
    files = fs.readdirSync(STORIES_DIR).filter(file => file.endsWith('.mdx'))
  } catch {
    return []
  }

  const references: SlugReference[] = []

  for (const file of files) {
    const raw = fs.readFileSync(path.join(STORIES_DIR, file), 'utf8')

    for (const match of raw.matchAll(BRAND_CARD_SLUG)) {
      references.push({ file, slug: match[1] })
    }

    for (const grid of raw.matchAll(BRAND_GRID_SLUGS)) {
      for (const entry of grid[1].matchAll(QUOTED_ENTRY)) {
        references.push({ file, slug: entry[1] })
      }
    }
  }

  return references
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
