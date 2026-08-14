import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { getAllTrails, getPublishedTrailBySlug, getTrailBySlug } from '../trails'

const trailsDir = join(process.cwd(), 'content', 'trails')
const checker = join(process.cwd(), 'scripts', 'checks', 'trail-frontmatter.mjs')
const fixtureStems = [
  'loader-superset-fixture',
  'loader-draft-fixture',
  'loader-published-fixture',
  'loader-malformed-fixture',
  'checker-slug-fixture',
  'checker-sections-fixture',
]

function writeTrail(stem: string, frontmatter: string, body = 'Body') {
  writeFileSync(join(trailsDir, `${stem}.mdx`), `---\n${frontmatter}\n---\n\n${body}\n`)
}

function validFrontmatter(
  stem: string,
  extra: string[] = [],
  sectionLines = ['  - key: first', '    title: First section'],
) {
  return [
    `slug: ${stem}`,
    'title: Fixture trail',
    'description: A fixture trail',
    'promise: Find a better corner',
    'readerSituation: A small room needs a reading place',
    'sections:',
    ...sectionLines,
    'tags:',
    '  - home',
    'locale: zh-TW',
    'publishedAt: 2026-08-15',
    'editorialOwner: Formoria Editorial',
    'reviewedAt: 2026-08-15',
    'reviewDueAt: 2027-08-15',
    'exclusions: Prices and stock are not covered.',
    'sources:',
    '  - https://example.com/source',
    'faq:',
    '  - q: What is this?',
    '    a: A fixture.',
    '  - q: Why?',
    '    a: Because.',
    '  - q: Who?',
    '    a: Formoria.',
    '  - q: When?',
    '    a: Today.',
    'draft: false',
    ...extra,
  ].join('\n')
}

beforeAll(() => mkdirSync(trailsDir, { recursive: true }))
afterAll(() => {
  for (const stem of fixtureStems) {
    rmSync(join(trailsDir, `${stem}.mdx`), { force: true })
  }
})

describe('trail content loader', () => {
  it('parses frontmatter into a TrailEntry', async () => {
    const stem = 'loader-superset-fixture'
    writeTrail(
      stem,
      validFrontmatter(stem, [
        'updatedAt: 2026-08-16',
        'author: Editorial team',
        'series: reading',
        'seriesTitle: Reading series',
        'seriesOrder: 1',
        'heroImage: https://images.example.com/hero.webp',
        'heroImageAlt: A reading corner',
        'voiceCanonical: true',
        'relatedCategories:',
        '  - home',
        'relatedStories:',
        '  - story-slug',
        'relatedTrails:',
        '  - another-trail',
      ], [
        '  - key: first',
        '    title: First section',
        '  - key: second',
        '    title: Second section',
      ]),
    )

    const result = await getTrailBySlug(stem)

    expect(result?.entry).toMatchObject({
      slug: stem,
      frontmatter: {
        slug: stem,
        title: 'Fixture trail',
        promise: 'Find a better corner',
        readerSituation: 'A small room needs a reading place',
        sections: [
          { key: 'first', title: 'First section' },
          { key: 'second', title: 'Second section' },
        ],
        relatedCategories: ['home'],
        relatedStories: ['story-slug'],
        relatedTrails: ['another-trail'],
        voiceCanonical: true,
      },
    })
    expect(result?.content).toContain('Body')
  })

  it('degrades malformed frontmatter to defaults rather than throwing', async () => {
    const stem = 'loader-malformed-fixture'
    writeFileSync(join(trailsDir, `${stem}.mdx`), '---\ntitle: [\n---\n\nBody\n')

    const result = await getTrailBySlug(stem)

    expect(result?.entry.frontmatter).toMatchObject({
      title: '',
      slug: stem,
      tags: [],
      sections: [],
      sources: [],
      faq: [],
      draft: false,
    })
  })

  it('getPublishedTrailBySlug returns null for draft: true', async () => {
    const stem = 'loader-draft-fixture'
    writeTrail(stem, validFrontmatter(stem).replace('draft: false', 'draft: true'))

    await expect(getPublishedTrailBySlug(stem)).resolves.toBeNull()
  })

  it('getAllTrails excludes drafts', async () => {
    writeTrail('loader-published-fixture', validFrontmatter('loader-published-fixture'))

    const result = await getAllTrails()

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.trails.map((trail) => trail.slug)).toContain('loader-published-fixture')
      expect(result.trails.map((trail) => trail.slug)).not.toContain('loader-draft-fixture')
    }
  })
})

describe('trail frontmatter checker', () => {
  it('rejects a slug that differs from the filename stem', () => {
    const stem = 'checker-slug-fixture'
    writeTrail(stem, validFrontmatter(stem).replace(`slug: ${stem}`, 'slug: different-slug'))

    expect(() => execFileSync(process.execPath, [checker], { encoding: 'utf8' })).toThrow()
  })

  it('rejects duplicate or blank section keys', () => {
    const stem = 'checker-sections-fixture'
    writeTrail(
      stem,
      validFrontmatter(stem, [], [
        '  - key: first',
        '    title: First section',
        '  - key: first',
        '    title: Duplicate',
        '  - key: ""',
        '    title: Blank',
      ]),
    )

    expect(() => execFileSync(process.execPath, [checker], { encoding: 'utf8' })).toThrow()
  })
})
