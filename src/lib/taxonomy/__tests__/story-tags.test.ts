import fs from 'fs'
import path from 'path'

import matter from 'gray-matter'
import { describe, expect, it } from 'vitest'

import { L1_CATEGORIES } from '../ontology'
import { STORY_EDITORIAL_TAGS, STORY_TAGS, isStoryTag } from '../story-tags'

// NOTE: this suite reads real files off disk on purpose — it must never mock
// `fs`. The sibling suite `src/lib/services/stories.test.ts` mocks `fs`
// globally; that mock stays in its own module graph.

const STORIES_DIR = path.join(process.cwd(), 'content', 'stories')

function readStoryFrontmatter(): Array<{ file: string; tags: unknown }> {
  let files: string[]
  try {
    files = fs.readdirSync(STORIES_DIR).filter(file => file.endsWith('.mdx'))
  } catch {
    return []
  }

  return files.map(file => {
    const raw = fs.readFileSync(path.join(STORIES_DIR, file), 'utf8')
    const { data } = matter(raw)
    return { file, tags: data.tags }
  })
}

describe('STORY_TAGS vocabulary', () => {
  it('includes every L1_CATEGORIES slug', () => {
    for (const category of L1_CATEGORIES) {
      expect(STORY_TAGS).toContain(category.slug)
    }
  })

  it('contains the event editorial tag', () => {
    expect(STORY_TAGS).toContain('event')
    expect(STORY_EDITORIAL_TAGS).toContain('event')
    expect(isStoryTag('event')).toBe(true)
  })

  it('rejects values outside the vocabulary', () => {
    expect(isStoryTag('not-a-real-tag')).toBe(false)
    expect(isStoryTag('')).toBe(false)
  })
})

describe('authored story frontmatter', () => {
  it('every tag in every content/stories frontmatter is a member of STORY_TAGS', () => {
    // Vacuous while `content/stories/` holds only `.gitkeep`; becomes
    // load-bearing the moment the first expo story lands.
    const entries = readStoryFrontmatter()

    for (const { file, tags } of entries) {
      if (tags === undefined) continue
      expect(Array.isArray(tags), `${file}: tags must be an array`).toBe(true)

      for (const tag of tags as unknown[]) {
        expect(
          typeof tag === 'string' && isStoryTag(tag),
          `${file}: "${String(tag)}" is not a member of STORY_TAGS`,
        ).toBe(true)
      }
    }
  })
})
