import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('fs')
vi.mock('gray-matter', () => ({
  default: vi.fn(),
}))

import fs from 'fs'
import matter from 'gray-matter'
import {
  getAllStories,
  getStoryBySlug,
  getStoriesByTag,
  getStorySeries,
  getPublishedStoryBySlug,
} from './stories'

const mockFrontmatter = {
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

const mockRawMdx = `---\ntitle: 在鶯歌燒出一只碗\n---\n\nContent here.`

describe('stories service (filesystem-backed)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getAllStories', () => {
    it('returns stories with preserved nested frontmatter shape', async () => {
      vi.mocked(fs.readdirSync).mockReturnValue(['yingge-kiln-bowl.mdx'] as unknown as ReturnType<typeof fs.readdirSync>)
      vi.mocked(fs.readFileSync).mockReturnValue(mockRawMdx)
      vi.mocked(matter).mockReturnValue({ data: mockFrontmatter, content: 'Content here.' } as unknown as ReturnType<typeof matter>)

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
      vi.mocked(fs.readdirSync).mockReturnValue(['en-story.mdx'] as unknown as ReturnType<typeof fs.readdirSync>)
      vi.mocked(fs.readFileSync).mockReturnValue(mockRawMdx)
      vi.mocked(matter).mockReturnValue({
        data: { ...mockFrontmatter, locale: 'en' },
        content: 'Content.',
      } as unknown as ReturnType<typeof matter>)

      const result = await getAllStories()
      expect(result.ok).toBe(true)
      if (!result.ok) throw result.error
      expect(result.stories).toHaveLength(0)
    })

    it('falls back to the zh-TW set for the en locale while no English edition exists', async () => {
      vi.mocked(fs.readdirSync).mockReturnValue(['yingge-kiln-bowl.mdx'] as unknown as ReturnType<typeof fs.readdirSync>)
      vi.mocked(fs.readFileSync).mockReturnValue(mockRawMdx)
      vi.mocked(matter).mockReturnValue({ data: mockFrontmatter, content: 'Content here.' } as unknown as ReturnType<typeof matter>)

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
      vi.mocked(fs.readdirSync).mockReturnValue([
        'yingge-kiln-bowl.mdx',
        'en-story.mdx',
      ] as unknown as ReturnType<typeof fs.readdirSync>)
      vi.mocked(fs.readFileSync).mockReturnValue(mockRawMdx)
      vi.mocked(matter)
        .mockReturnValueOnce({ data: mockFrontmatter, content: 'Content here.' } as unknown as ReturnType<typeof matter>)
        .mockReturnValueOnce({ data: { ...mockFrontmatter, locale: 'en' }, content: 'Content.' } as unknown as ReturnType<typeof matter>)

      const enResult = await getAllStories('en')
      expect(enResult.ok).toBe(true)
      if (!enResult.ok) throw enResult.error
      expect(enResult.stories.map(story => story.slug)).toEqual(['en-story'])
    })

    it('filters out draft stories', async () => {
      vi.mocked(fs.readdirSync).mockReturnValue(['draft-story.mdx'] as unknown as ReturnType<typeof fs.readdirSync>)
      vi.mocked(fs.readFileSync).mockReturnValue(mockRawMdx)
      vi.mocked(matter).mockReturnValue({
        data: { ...mockFrontmatter, draft: true },
        content: 'Content.',
      } as unknown as ReturnType<typeof matter>)

      const result = await getAllStories()
      expect(result.ok).toBe(true)
      if (!result.ok) throw result.error
      expect(result.stories).toHaveLength(0)
    })

    it('returns an empty published list when the content directory is empty', async () => {
      // The surface ships with `content/stories/` holding only `.gitkeep`, so the
      // hub, the sitemap, and `generateStaticParams` all have to survive zero rows.
      vi.mocked(fs.readdirSync).mockReturnValue(['.gitkeep'] as unknown as ReturnType<typeof fs.readdirSync>)

      const result = await getAllStories()

      expect(result.ok).toBe(true)
      if (!result.ok) throw result.error
      expect(result.stories).toEqual([])
      expect(fs.readFileSync).not.toHaveBeenCalled()
    })

    it('handles missing optional fields with defaults', async () => {
      vi.mocked(fs.readdirSync).mockReturnValue(['yingge-kiln-bowl.mdx'] as unknown as ReturnType<typeof fs.readdirSync>)
      vi.mocked(fs.readFileSync).mockReturnValue(mockRawMdx)
      vi.mocked(matter).mockReturnValue({
        data: {
          ...mockFrontmatter,
          updatedAt: undefined,
          tags: undefined,
          sources: undefined,
          faq: undefined,
          draft: undefined,
        },
        content: 'Content.',
      } as unknown as ReturnType<typeof matter>)

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

  describe('getStoryBySlug', () => {
    it('returns entry with preserved shape and raw content string', async () => {
      vi.mocked(fs.readFileSync).mockReturnValue(mockRawMdx)
      vi.mocked(matter).mockReturnValue({
        data: mockFrontmatter,
        content: 'Content here.',
      } as unknown as ReturnType<typeof matter>)

      const result = await getStoryBySlug('yingge-kiln-bowl')

      expect(result).not.toBeNull()
      if (!result) throw new Error('Expected story detail result')
      expect(result.entry.slug).toBe('yingge-kiln-bowl')
      expect(result.entry.frontmatter.title).toBe('在鶯歌燒出一只碗')
      expect(typeof result.content).toBe('string')
    })

    it('parseStoryFile coerces a missing tags field to an empty array', async () => {
      // Legacy frontmatter authored before the tag axis existed must not crash
      // the parse — `tags` is always an array downstream.
      const legacyFrontmatter: Record<string, unknown> = { ...mockFrontmatter }
      delete legacyFrontmatter.tags
      vi.mocked(fs.readFileSync).mockReturnValue(mockRawMdx)
      vi.mocked(matter).mockReturnValue({
        data: legacyFrontmatter,
        content: 'Content.',
      } as unknown as ReturnType<typeof matter>)

      const result = await getStoryBySlug('yingge-kiln-bowl')

      expect(result).not.toBeNull()
      if (!result) throw new Error('Expected story detail result')
      expect(result.entry.frontmatter.tags).toEqual([])
    })

    it('returns null when the file does not exist', async () => {
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      })

      const result = await getStoryBySlug('missing-story')

      expect(result).toBeNull()
    })
  })

  describe('getPublishedStoryBySlug', () => {
    it('does not expose a draft story through the public query', async () => {
      vi.mocked(fs.readFileSync).mockReturnValue(mockRawMdx)
      vi.mocked(matter).mockReturnValue({
        data: { ...mockFrontmatter, draft: true },
        content: 'Content.',
      } as unknown as ReturnType<typeof matter>)

      await expect(
        getPublishedStoryBySlug('yingge-kiln-bowl'),
      ).resolves.toBeNull()
    })

    it('returns the story when it is published', async () => {
      vi.mocked(fs.readFileSync).mockReturnValue(mockRawMdx)
      vi.mocked(matter).mockReturnValue({
        data: { ...mockFrontmatter, draft: false },
        content: 'Content.',
      } as unknown as ReturnType<typeof matter>)

      const result = await getPublishedStoryBySlug('yingge-kiln-bowl')
      expect(result).not.toBeNull()
    })

    // Inverted from "returns null when the requested locale does not match": that gate
    // is what turned every /en/stories/<slug> into a 404 next to a live zh-TW twin.
    // English now serves the zh-TW document and canonicals to the zh-TW URL.
    it('serves the zh-TW document for an en request instead of 404ing', async () => {
      vi.mocked(fs.readFileSync).mockReturnValue(mockRawMdx)
      vi.mocked(matter).mockReturnValue({
        data: mockFrontmatter,
        content: 'Content.',
      } as unknown as ReturnType<typeof matter>)

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
      const files = ['yingge-kiln-bowl.mdx', 'tainan-soy-sauce.mdx', 'expo-report.mdx']
      vi.mocked(fs.readdirSync).mockReturnValue(files as unknown as ReturnType<typeof fs.readdirSync>)
      vi.mocked(fs.readFileSync).mockReturnValue(mockRawMdx)
      vi.mocked(matter)
        .mockReturnValueOnce({ data: { ...mockFrontmatter, slug: 'yingge-kiln-bowl', tags: ['home', 'crafts'] }, content: 'content' } as unknown as ReturnType<typeof matter>)
        .mockReturnValueOnce({ data: { ...mockFrontmatter, slug: 'tainan-soy-sauce', tags: ['food-drink'] }, content: 'content' } as unknown as ReturnType<typeof matter>)
        .mockReturnValueOnce({ data: { ...mockFrontmatter, slug: 'expo-report', tags: ['event', 'crafts'] }, content: 'content' } as unknown as ReturnType<typeof matter>)

      const result = await getStoriesByTag('crafts')
      expect(result.ok).toBe(true)
      if (!result.ok) throw result.error

      // Membership, not equality: `crafts` is a secondary tag on both matches.
      expect(result.stories.map(story => story.slug)).toEqual([
        'yingge-kiln-bowl',
        'expo-report',
      ])
      for (const story of result.stories) {
        expect(story.frontmatter.tags).toContain('crafts')
      }
    })

    it('filters by locale and excludes drafts', async () => {
      const files = ['zh-published.mdx', 'zh-draft.mdx', 'en-published.mdx']
      vi.mocked(fs.readdirSync).mockReturnValue(files as unknown as ReturnType<typeof fs.readdirSync>)
      vi.mocked(fs.readFileSync).mockReturnValue(mockRawMdx)
      vi.mocked(matter)
        .mockReturnValueOnce({ data: { ...mockFrontmatter, slug: 'zh-published', tags: ['home'] }, content: 'content' } as unknown as ReturnType<typeof matter>)
        .mockReturnValueOnce({ data: { ...mockFrontmatter, slug: 'zh-draft', tags: ['home'], draft: true }, content: 'content' } as unknown as ReturnType<typeof matter>)
        .mockReturnValueOnce({ data: { ...mockFrontmatter, slug: 'en-published', tags: ['home'], locale: 'en' }, content: 'content' } as unknown as ReturnType<typeof matter>)

      const result = await getStoriesByTag('home')
      expect(result.ok).toBe(true)
      if (!result.ok) throw result.error
      expect(result.stories.map(story => story.slug)).toEqual(['zh-published'])
    })
  })

  describe('getStorySeries', () => {
    it('returns members sorted by seriesOrder ascending', async () => {
      const files = ['part-three.mdx', 'part-one.mdx', 'part-unordered.mdx', 'part-two.mdx']
      vi.mocked(fs.readdirSync).mockReturnValue(files as unknown as ReturnType<typeof fs.readdirSync>)
      vi.mocked(fs.readFileSync).mockReturnValue(mockRawMdx)
      vi.mocked(matter)
        .mockReturnValueOnce({ data: { ...mockFrontmatter, slug: 'part-three', series: 'expo-2026', seriesTitle: '2026 Expo', seriesOrder: 3 }, content: 'content' } as unknown as ReturnType<typeof matter>)
        .mockReturnValueOnce({ data: { ...mockFrontmatter, slug: 'part-one', series: 'expo-2026', seriesTitle: '2026 Expo', seriesOrder: 1 }, content: 'content' } as unknown as ReturnType<typeof matter>)
        .mockReturnValueOnce({ data: { ...mockFrontmatter, slug: 'part-unordered', series: 'expo-2026', seriesTitle: '2026 Expo' }, content: 'content' } as unknown as ReturnType<typeof matter>)
        .mockReturnValueOnce({ data: { ...mockFrontmatter, slug: 'part-two', series: 'expo-2026', seriesTitle: '2026 Expo', seriesOrder: 2 }, content: 'content' } as unknown as ReturnType<typeof matter>)

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
      const files = ['zh-published.mdx', 'zh-draft.mdx', 'en-published.mdx']
      vi.mocked(fs.readdirSync).mockReturnValue(files as unknown as ReturnType<typeof fs.readdirSync>)
      vi.mocked(fs.readFileSync).mockReturnValue(mockRawMdx)
      vi.mocked(matter)
        .mockReturnValueOnce({ data: { ...mockFrontmatter, slug: 'zh-published', series: 'expo-2026', seriesOrder: 1 }, content: 'content' } as unknown as ReturnType<typeof matter>)
        .mockReturnValueOnce({ data: { ...mockFrontmatter, slug: 'zh-draft', series: 'expo-2026', seriesOrder: 2, draft: true }, content: 'content' } as unknown as ReturnType<typeof matter>)
        .mockReturnValueOnce({ data: { ...mockFrontmatter, slug: 'en-published', series: 'expo-2026', seriesOrder: 3, locale: 'en' }, content: 'content' } as unknown as ReturnType<typeof matter>)

      const result = await getStorySeries('expo-2026')
      expect(result.ok).toBe(true)
      if (!result.ok) throw result.error
      expect(result.stories.map(story => story.slug)).toEqual(['zh-published'])
    })

    it('returns an empty list for an unknown series id', async () => {
      vi.mocked(fs.readdirSync).mockReturnValue(['part-one.mdx'] as unknown as ReturnType<typeof fs.readdirSync>)
      vi.mocked(fs.readFileSync).mockReturnValue(mockRawMdx)
      vi.mocked(matter).mockReturnValue({
        data: { ...mockFrontmatter, slug: 'part-one', series: 'expo-2026', seriesOrder: 1 },
        content: 'content',
      } as unknown as ReturnType<typeof matter>)

      const result = await getStorySeries('no-such-series')
      expect(result.ok).toBe(true)
      if (!result.ok) throw result.error
      expect(result.stories).toEqual([])
    })

    it('excludes stories with no series field from every series result', async () => {
      const files = ['standalone-a.mdx', 'standalone-b.mdx', 'part-one.mdx']
      vi.mocked(fs.readdirSync).mockReturnValue(files as unknown as ReturnType<typeof fs.readdirSync>)
      vi.mocked(fs.readFileSync).mockReturnValue(mockRawMdx)
      vi.mocked(matter)
        .mockReturnValueOnce({ data: { ...mockFrontmatter, slug: 'standalone-a' }, content: 'content' } as unknown as ReturnType<typeof matter>)
        .mockReturnValueOnce({ data: { ...mockFrontmatter, slug: 'standalone-b' }, content: 'content' } as unknown as ReturnType<typeof matter>)
        .mockReturnValueOnce({ data: { ...mockFrontmatter, slug: 'part-one', series: 'expo-2026', seriesOrder: 1 }, content: 'content' } as unknown as ReturnType<typeof matter>)

      const result = await getStorySeries('expo-2026')
      expect(result.ok).toBe(true)
      if (!result.ok) throw result.error

      // Two `series: undefined` stories must never be grouped together.
      expect(result.stories.map(story => story.slug)).toEqual(['part-one'])
    })
  })
})
