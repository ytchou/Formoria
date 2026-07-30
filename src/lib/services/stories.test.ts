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
  getStoriesByCategory,
  getPublishedStoryBySlug,
} from './stories'

const mockFrontmatter = {
  title: '在鶯歌燒出一只碗',
  description: '走訪鶯歌窯廠，看一只日用碗如何從土坯到出窯',
  slug: 'yingge-kiln-bowl',
  category: 'home',
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
      expect(stories[0].frontmatter.category).toBe('home')
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

    it('returns no stories for the en locale when the only story is zh-TW', async () => {
      vi.mocked(fs.readdirSync).mockReturnValue(['yingge-kiln-bowl.mdx'] as unknown as ReturnType<typeof fs.readdirSync>)
      vi.mocked(fs.readFileSync).mockReturnValue(mockRawMdx)
      vi.mocked(matter).mockReturnValue({ data: mockFrontmatter, content: 'Content here.' } as unknown as ReturnType<typeof matter>)

      const enResult = await getAllStories('en')
      expect(enResult.ok).toBe(true)
      if (!enResult.ok) throw enResult.error
      expect(enResult.stories).toHaveLength(0)

      const defaultResult = await getAllStories()
      expect(defaultResult.ok).toBe(true)
      if (!defaultResult.ok) throw defaultResult.error
      expect(defaultResult.stories).toHaveLength(1)
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

    it('returns null when the requested locale does not match the authored locale', async () => {
      vi.mocked(fs.readFileSync).mockReturnValue(mockRawMdx)
      vi.mocked(matter).mockReturnValue({
        data: mockFrontmatter,
        content: 'Content.',
      } as unknown as ReturnType<typeof matter>)

      await expect(
        getPublishedStoryBySlug('yingge-kiln-bowl', 'en'),
      ).resolves.toBeNull()
      await expect(
        getPublishedStoryBySlug('yingge-kiln-bowl', 'zh-TW'),
      ).resolves.not.toBeNull()
    })
  })

  describe('getStoriesByCategory', () => {
    it('filters by category, locale, and draft status', async () => {
      const files = ['yingge-kiln-bowl.mdx', 'tainan-soy-sauce.mdx']
      vi.mocked(fs.readdirSync).mockReturnValue(files as unknown as ReturnType<typeof fs.readdirSync>)
      vi.mocked(fs.readFileSync)
        .mockReturnValueOnce(mockRawMdx)
        .mockReturnValueOnce(mockRawMdx)
      vi.mocked(matter)
        .mockReturnValueOnce({ data: { ...mockFrontmatter, slug: 'yingge-kiln-bowl', category: 'home' }, content: 'content' } as unknown as ReturnType<typeof matter>)
        .mockReturnValueOnce({ data: { ...mockFrontmatter, slug: 'tainan-soy-sauce', category: 'food-drink' }, content: 'content' } as unknown as ReturnType<typeof matter>)

      const result = await getStoriesByCategory('home')
      expect(result.ok).toBe(true)
      if (!result.ok) throw result.error
      expect(result.stories).toHaveLength(1)
      expect(result.stories[0].frontmatter.category).toBe('home')
    })

    it('returns no stories for the en locale when the category stories are zh-TW', async () => {
      vi.mocked(fs.readdirSync).mockReturnValue(['yingge-kiln-bowl.mdx'] as unknown as ReturnType<typeof fs.readdirSync>)
      vi.mocked(fs.readFileSync).mockReturnValue(mockRawMdx)
      vi.mocked(matter).mockReturnValue({
        data: { ...mockFrontmatter, slug: 'yingge-kiln-bowl', category: 'home' },
        content: 'content',
      } as unknown as ReturnType<typeof matter>)

      const result = await getStoriesByCategory('home', 'en')
      expect(result.ok).toBe(true)
      if (!result.ok) throw result.error
      expect(result.stories).toHaveLength(0)
    })
  })
})
