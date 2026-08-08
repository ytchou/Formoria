import path from 'path'

import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * `fs` is mocked — it is the system boundary. `gray-matter` deliberately is NOT.
 *
 * It is a fast, deterministic, in-process parser, and every coercion in
 * `parseStoryFile` exists to defend against what YAML does to author-typed
 * frontmatter: an unquoted date becomes a JS `Date`, `draft: no` becomes a
 * boolean, a single-item list stays a scalar. Mocking it away hands the service
 * a pre-built JS object and removes the only thing those coercions are for, so
 * these fixtures are real YAML strings and the real parser runs.
 */
vi.mock('fs')

import fs from 'fs'
import {
  getAllStories,
  getStoryBySlug,
  getStoriesByTag,
  getStorySeries,
  getStorySeriesByRecency,
  getPublishedStoryBySlug,
} from './stories'

/** Frontmatter value emitted verbatim, for pinning YAML's own type inference. */
type RawYaml = { __raw: string }
const raw = (value: string): RawYaml => ({ __raw: value })

function isRaw(value: unknown): value is RawYaml {
  return typeof value === 'object' && value !== null && '__raw' in value
}

function yamlScalar(value: unknown): string {
  if (isRaw(value)) return value.__raw
  if (typeof value === 'string') return JSON.stringify(value)
  return String(value)
}

function yamlEntry(key: string, value: unknown): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return `${key}: []`
    if (value.every((item) => typeof item === 'object' && item !== null && !isRaw(item))) {
      const block = (value as Array<Record<string, unknown>>)
        .map((item) =>
          Object.entries(item)
            .map(([k, v], index) => `${index === 0 ? '  - ' : '    '}${k}: ${yamlScalar(v)}`)
            .join('\n'),
        )
        .join('\n')
      return `${key}:\n${block}`
    }
    return `${key}: [${value.map(yamlScalar).join(', ')}]`
  }
  return `${key}: ${yamlScalar(value)}`
}

/** Serializes fixture fields into the MDX-with-frontmatter shape authors write. */
function storyFile(fields: Record<string, unknown>, body = 'Content here.'): string {
  const lines = Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => yamlEntry(key, value))

  return `---\n${lines.join('\n')}\n---\n\n${body}\n`
}

const baseFields: Record<string, unknown> = {
  title: '在鶯歌燒出一只碗',
  description: '走訪鶯歌窯廠，看一只日用碗如何從土坯到出窯',
  slug: 'yingge-kiln-bowl',
  tags: ['home', 'crafts'],
  locale: 'zh-TW',
  publishedAt: '2026-06-15T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  draft: false,
  sources: ['https://example.com/source'],
  faq: [{ q: '鶯歌的陶土有什麼不同？', a: '含鐵量較高，燒成後偏暖色。' }],
}

/**
 * Serves `content/stories/<name>` from an in-memory map, keyed by filename.
 * Keyed rather than sequenced because the `en` fallback reads the directory
 * twice, so a `mockReturnValueOnce` chain runs dry halfway through.
 */
function mockStoryFiles(files: Record<string, string>) {
  vi.mocked(fs.readdirSync).mockReturnValue(
    Object.keys(files) as unknown as ReturnType<typeof fs.readdirSync>,
  )
  vi.mocked(fs.readFileSync).mockImplementation(((filePath: string) => {
    const content = files[path.basename(String(filePath))]
    if (content === undefined) {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    }
    return content
  }) as unknown as typeof fs.readFileSync)
}

describe('stories service (filesystem-backed)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getAllStories', () => {
    it('returns stories with preserved nested frontmatter shape', async () => {
      mockStoryFiles({ 'yingge-kiln-bowl.mdx': storyFile(baseFields) })

      const result = await getAllStories()
      expect(result.ok).toBe(true)
      if (!result.ok) throw result.error
      const stories = result.stories

      expect(stories).toHaveLength(1)
      expect(stories[0].slug).toBe('yingge-kiln-bowl')
      expect(stories[0].frontmatter.title).toBe('在鶯歌燒出一只碗')
      expect(stories[0].frontmatter.description).toBe('走訪鶯歌窯廠，看一只日用碗如何從土坯到出窯')
      expect(stories[0].frontmatter.tags).toEqual(['home', 'crafts'])
      expect(stories[0].frontmatter.locale).toBe('zh-TW')
      expect(stories[0].frontmatter.publishedAt).toBe('2026-06-15T00:00:00.000Z')
      expect(stories[0].frontmatter.faq).toEqual([
        { q: '鶯歌的陶土有什麼不同？', a: '含鐵量較高，燒成後偏暖色。' },
      ])
      expect(stories[0].frontmatter.sources).toEqual(['https://example.com/source'])
      expect(stories[0].frontmatter.draft).toBe(false)
    })

    it('filters out non-zh-TW locale stories', async () => {
      mockStoryFiles({
        'en-story.mdx': storyFile({ ...baseFields, locale: 'en' }),
      })

      const result = await getAllStories()
      expect(result.ok).toBe(true)
      if (!result.ok) throw result.error
      expect(result.stories).toHaveLength(0)
    })

    it('falls back to the zh-TW set for the en locale while no English edition exists', async () => {
      mockStoryFiles({ 'yingge-kiln-bowl.mdx': storyFile(baseFields) })

      const enResult = await getAllStories('en')
      expect(enResult.ok).toBe(true)
      if (!enResult.ok) throw enResult.error
      expect(enResult.stories.map(story => story.slug)).toEqual(['yingge-kiln-bowl'])

      const defaultResult = await getAllStories()
      expect(defaultResult.ok).toBe(true)
      if (!defaultResult.ok) throw defaultResult.error
      expect(defaultResult.stories).toHaveLength(1)
    })

    it('prefers real English editions over the zh-TW fallback once they exist', async () => {
      mockStoryFiles({
        'yingge-kiln-bowl.mdx': storyFile(baseFields),
        'en-story.mdx': storyFile({ ...baseFields, slug: 'en-story', locale: 'en' }),
      })

      const enResult = await getAllStories('en')
      expect(enResult.ok).toBe(true)
      if (!enResult.ok) throw enResult.error
      expect(enResult.stories.map(story => story.slug)).toEqual(['en-story'])
    })

    it('filters out draft stories', async () => {
      mockStoryFiles({
        'draft-story.mdx': storyFile({ ...baseFields, slug: 'draft-story', draft: true }),
      })

      const result = await getAllStories()
      expect(result.ok).toBe(true)
      if (!result.ok) throw result.error
      expect(result.stories).toHaveLength(0)
    })

    it('returns an empty published list when the content directory is empty', async () => {
      // The surface ships with `content/stories/` holding only `.gitkeep`, so the
      // hub, the sitemap, and `generateStaticParams` all have to survive zero rows.
      mockStoryFiles({ '.gitkeep': '' })

      const result = await getAllStories()

      expect(result.ok).toBe(true)
      if (!result.ok) throw result.error
      expect(result.stories).toEqual([])
      expect(fs.readFileSync).not.toHaveBeenCalled()
    })

    it('handles missing optional fields with defaults', async () => {
      // Rest-siblings drop the optional keys, leaving only what an author must type.
      const { updatedAt, tags, sources, faq, draft, ...required } = baseFields
      mockStoryFiles({ 'yingge-kiln-bowl.mdx': storyFile(required) })

      const result = await getAllStories()
      expect(result.ok).toBe(true)
      if (!result.ok) throw result.error
      const stories = result.stories

      expect(stories[0].frontmatter.updatedAt).toBeUndefined()
      expect(stories[0].frontmatter.tags).toEqual([])
      expect(stories[0].frontmatter.sources).toEqual([])
      expect(stories[0].frontmatter.faq).toEqual([])
      expect(stories[0].frontmatter.draft).toBe(false)
    })

    it('returns a failure result and logs filesystem errors', async () => {
      const error = new Error('ENOENT: directory not found')
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      vi.mocked(fs.readdirSync).mockImplementation(() => { throw error })

      const result = await getAllStories()

      expect(result).toEqual({ ok: false, error })
      expect(consoleError).toHaveBeenCalledWith(
        '[stories:getAllStories] filesystem read failed',
        error,
      )
      consoleError.mockRestore()
    })
  })

  describe('frontmatter coercion (real YAML)', () => {
    it('normalizes an unquoted YAML date into an ISO-8601 string', async () => {
      // `publishedAt: 2026-06-15` (no quotes) is a YAML *timestamp*, so the
      // parser hands the service a JS `Date`, not a string. Stringifying that
      // naively yields "Mon Jun 15 2026 08:00:00 GMT+0800 (…)", which the detail
      // route would put in `datePublished` — schema.org requires ISO-8601, and
      // Google reports anything else as an invalid value. Authors write
      // unquoted dates constantly, so the service must normalize here.
      mockStoryFiles({
        'yingge-kiln-bowl.mdx': storyFile({ ...baseFields, publishedAt: raw('2026-06-15') }),
      })

      const result = await getStoryBySlug('yingge-kiln-bowl')

      expect(result).not.toBeNull()
      if (!result) throw new Error('Expected story detail result')
      expect(result.entry.frontmatter.publishedAt).toBe('2026-06-15T00:00:00.000Z')
    })

    it('leaves a story with no publishedAt renderable instead of throwing', async () => {
      // Empty string is the documented default. It must stay a string: the hub
      // and the Article JSON-LD both guard it, and neither can guard `undefined`
      // through a `string` type.
      const { publishedAt, ...withoutDate } = baseFields
      mockStoryFiles({ 'yingge-kiln-bowl.mdx': storyFile(withoutDate) })

      const result = await getStoryBySlug('yingge-kiln-bowl')

      expect(result).not.toBeNull()
      if (!result) throw new Error('Expected story detail result')
      expect(result.entry.frontmatter.publishedAt).toBe('')
    })

    it('reads a numeric seriesOrder as a number and ignores a non-numeric one', async () => {
      mockStoryFiles({
        'part-one.mdx': storyFile({
          ...baseFields,
          slug: 'part-one',
          series: 'expo-2026',
          seriesOrder: 2,
        }),
        'part-bad.mdx': storyFile({
          ...baseFields,
          slug: 'part-bad',
          series: 'expo-2026',
          seriesOrder: 'second',
        }),
      })

      const result = await getStorySeries('expo-2026')
      expect(result.ok).toBe(true)
      if (!result.ok) throw result.error

      const bySlug = new Map(result.stories.map(story => [story.slug, story]))
      expect(bySlug.get('part-one')?.frontmatter.seriesOrder).toBe(2)
      expect(bySlug.get('part-bad')?.frontmatter.seriesOrder).toBeUndefined()
    })
  })

  describe('getStoryBySlug', () => {
    it('returns entry with preserved shape and raw content string', async () => {
      mockStoryFiles({
        'yingge-kiln-bowl.mdx': storyFile(baseFields, 'The kiln has run since 1974.'),
      })

      const result = await getStoryBySlug('yingge-kiln-bowl')

      expect(result).not.toBeNull()
      if (!result) throw new Error('Expected story detail result')
      expect(result.entry.slug).toBe('yingge-kiln-bowl')
      expect(result.entry.frontmatter.title).toBe('在鶯歌燒出一只碗')
      expect(result.content).toContain('The kiln has run since 1974.')
    })

    it('parseStoryFile coerces a missing tags field to an empty array', async () => {
      // Legacy frontmatter authored before the tag axis existed must not crash
      // the parse — `tags` is always an array downstream.
      const { tags, ...legacyFields } = baseFields
      mockStoryFiles({ 'yingge-kiln-bowl.mdx': storyFile(legacyFields) })

      const result = await getStoryBySlug('yingge-kiln-bowl')

      expect(result).not.toBeNull()
      if (!result) throw new Error('Expected story detail result')
      expect(result.entry.frontmatter.tags).toEqual([])
    })

    it('returns null when the file does not exist', async () => {
      mockStoryFiles({})

      const result = await getStoryBySlug('missing-story')

      expect(result).toBeNull()
    })
  })

  describe('getPublishedStoryBySlug', () => {
    it('does not expose a draft story through the public query', async () => {
      mockStoryFiles({
        'yingge-kiln-bowl.mdx': storyFile({ ...baseFields, draft: true }),
      })

      await expect(
        getPublishedStoryBySlug('yingge-kiln-bowl'),
      ).resolves.toBeNull()
    })

    it('returns the story when it is published', async () => {
      mockStoryFiles({ 'yingge-kiln-bowl.mdx': storyFile(baseFields) })

      const result = await getPublishedStoryBySlug('yingge-kiln-bowl')
      expect(result).not.toBeNull()
    })

    // Inverted from "returns null when the requested locale does not match": that gate
    // is what turned every /en/stories/<slug> into a 404 next to a live zh-TW twin.
    // English now serves the zh-TW document and canonicals to the zh-TW URL.
    it('serves the zh-TW document for an en request instead of 404ing', async () => {
      mockStoryFiles({ 'yingge-kiln-bowl.mdx': storyFile(baseFields) })

      const enResult = await getPublishedStoryBySlug('yingge-kiln-bowl', 'en')
      expect(enResult).not.toBeNull()
      expect(enResult?.entry.frontmatter.locale).toBe('zh-TW')

      await expect(
        getPublishedStoryBySlug('yingge-kiln-bowl', 'zh-TW'),
      ).resolves.not.toBeNull()
    })
  })

  describe('getStoriesByTag', () => {
    it('returns only stories whose tags array contains the tag', async () => {
      mockStoryFiles({
        // Distinct `publishedAt` values on the two matches, so the expectation
        // below pins newest-first ordering rather than the equal-timestamp
        // slug tie-break it would otherwise assert by accident.
        'yingge-kiln-bowl.mdx': storyFile({
          ...baseFields,
          publishedAt: '2026-06-20T00:00:00.000Z',
          tags: ['home', 'crafts'],
        }),
        'tainan-soy-sauce.mdx': storyFile({
          ...baseFields,
          slug: 'tainan-soy-sauce',
          tags: ['food-drink'],
        }),
        'expo-report.mdx': storyFile({
          ...baseFields,
          slug: 'expo-report',
          publishedAt: '2026-06-10T00:00:00.000Z',
          tags: ['event', 'crafts'],
        }),
      })

      const result = await getStoriesByTag('crafts')
      expect(result.ok).toBe(true)
      if (!result.ok) throw result.error

      // Membership, not equality: `crafts` is a secondary tag on both matches.
      // Order is newest-first by `publishedAt`.
      expect(result.stories.map(story => story.slug)).toEqual([
        'yingge-kiln-bowl',
        'expo-report',
      ])
      for (const story of result.stories) {
        expect(story.frontmatter.tags).toContain('crafts')
      }
    })

    it('filters by locale and excludes drafts', async () => {
      mockStoryFiles({
        'zh-published.mdx': storyFile({ ...baseFields, slug: 'zh-published', tags: ['home'] }),
        'zh-draft.mdx': storyFile({
          ...baseFields,
          slug: 'zh-draft',
          tags: ['home'],
          draft: true,
        }),
        'en-published.mdx': storyFile({
          ...baseFields,
          slug: 'en-published',
          tags: ['home'],
          locale: 'en',
        }),
      })

      const result = await getStoriesByTag('home')
      expect(result.ok).toBe(true)
      if (!result.ok) throw result.error
      expect(result.stories.map(story => story.slug)).toEqual(['zh-published'])
    })
  })

  describe('getStorySeries', () => {
    it('returns members sorted by seriesOrder ascending', async () => {
      const member = (slug: string, seriesOrder?: number) =>
        storyFile({
          ...baseFields,
          slug,
          series: 'expo-2026',
          seriesTitle: '2026 Expo',
          seriesOrder,
        })

      mockStoryFiles({
        'part-three.mdx': member('part-three', 3),
        'part-one.mdx': member('part-one', 1),
        'part-unordered.mdx': member('part-unordered'),
        'part-two.mdx': member('part-two', 2),
      })

      const result = await getStorySeries('expo-2026')
      expect(result.ok).toBe(true)
      if (!result.ok) throw result.error

      // Unordered members sink to the end deterministically.
      expect(result.stories.map(story => story.slug)).toEqual([
        'part-one',
        'part-two',
        'part-three',
        'part-unordered',
      ])
    })

    it('excludes drafts and other locales', async () => {
      mockStoryFiles({
        'zh-published.mdx': storyFile({
          ...baseFields,
          slug: 'zh-published',
          series: 'expo-2026',
          seriesOrder: 1,
        }),
        'zh-draft.mdx': storyFile({
          ...baseFields,
          slug: 'zh-draft',
          series: 'expo-2026',
          seriesOrder: 2,
          draft: true,
        }),
        'en-published.mdx': storyFile({
          ...baseFields,
          slug: 'en-published',
          series: 'expo-2026',
          seriesOrder: 3,
          locale: 'en',
        }),
      })

      const result = await getStorySeries('expo-2026')
      expect(result.ok).toBe(true)
      if (!result.ok) throw result.error
      expect(result.stories.map(story => story.slug)).toEqual(['zh-published'])
    })

    it('returns an empty list for an unknown series id', async () => {
      mockStoryFiles({
        'part-one.mdx': storyFile({
          ...baseFields,
          slug: 'part-one',
          series: 'expo-2026',
          seriesOrder: 1,
        }),
      })

      const result = await getStorySeries('no-such-series')
      expect(result.ok).toBe(true)
      if (!result.ok) throw result.error
      expect(result.stories).toEqual([])
    })

    it('excludes stories with no series field from every series result', async () => {
      mockStoryFiles({
        'standalone-a.mdx': storyFile({ ...baseFields, slug: 'standalone-a' }),
        'standalone-b.mdx': storyFile({ ...baseFields, slug: 'standalone-b' }),
        'part-one.mdx': storyFile({
          ...baseFields,
          slug: 'part-one',
          series: 'expo-2026',
          seriesOrder: 1,
        }),
      })

      const result = await getStorySeries('expo-2026')
      expect(result.ok).toBe(true)
      if (!result.ok) throw result.error

      // Two `series: undefined` stories must never be grouped together.
      expect(result.stories.map(story => story.slug)).toEqual(['part-one'])
    })
  })

  describe('getStorySeriesByRecency', () => {
    it('orders by updatedAt descending, ignoring seriesOrder', async () => {
      const member = (
        slug: string,
        seriesOrder: number,
        updatedAt: string | undefined,
        publishedAt: string,
      ) =>
        storyFile({
          ...baseFields,
          slug,
          series: 'expo-2026',
          seriesOrder,
          publishedAt,
          updatedAt,
        })

      mockStoryFiles({
        // Authored first, revised most recently — must lead despite seriesOrder 1.
        'part-one.mdx': member(
          'part-one',
          1,
          '2026-08-07T00:00:00.000Z',
          '2026-06-01T00:00:00.000Z',
        ),
        // Never revised: falls back to its own publishedAt.
        'part-two.mdx': member(
          'part-two',
          2,
          undefined,
          '2026-08-01T00:00:00.000Z',
        ),
        'part-three.mdx': member(
          'part-three',
          3,
          '2026-07-02T00:00:00.000Z',
          '2026-07-01T00:00:00.000Z',
        ),
      })

      const result = await getStorySeriesByRecency('expo-2026')
      expect(result.ok).toBe(true)
      if (!result.ok) throw result.error

      expect(result.stories.map(story => story.slug)).toEqual([
        'part-one',
        'part-two',
        'part-three',
      ])
    })

    it('leaves the authored order of getStorySeries untouched', async () => {
      const files = {
        'part-one.mdx': storyFile({
          ...baseFields,
          slug: 'part-one',
          series: 'expo-2026',
          seriesOrder: 1,
          updatedAt: '2026-08-07T00:00:00.000Z',
        }),
        'part-two.mdx': storyFile({
          ...baseFields,
          slug: 'part-two',
          series: 'expo-2026',
          seriesOrder: 2,
          updatedAt: '2026-08-09T00:00:00.000Z',
        }),
      }

      mockStoryFiles(files)
      const authored = await getStorySeries('expo-2026')
      mockStoryFiles(files)
      const recent = await getStorySeriesByRecency('expo-2026')

      expect(authored.ok && recent.ok).toBe(true)
      if (!authored.ok || !recent.ok) throw new Error('series read failed')

      // The two callers must disagree here — that disagreement is the point.
      expect(authored.stories.map(s => s.slug)).toEqual(['part-one', 'part-two'])
      expect(recent.stories.map(s => s.slug)).toEqual(['part-two', 'part-one'])
    })
  })
})
