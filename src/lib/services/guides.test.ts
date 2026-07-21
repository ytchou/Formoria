import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('fs')
vi.mock('gray-matter', () => ({
  default: vi.fn(),
}))

import fs from 'fs'
import matter from 'gray-matter'
import {
  getAllGuides,
  getGuideBySlug,
  getGuidesByCategory,
  getPublishedGuideBySlug,
} from './guides'

const mockFrontmatter = {
  title: 'Taiwan Skincare Brands',
  description: 'Top skincare brands from Taiwan',
  slug: 'taiwan-skincare-brands',
  category: 'beauty',
  locale: 'zh-TW',
  publishedAt: '2026-06-15T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  draft: false,
  sources: ['https://example.com/source'],
  faq: [{ q: 'What makes Taiwan skincare special?', a: 'High-quality ingredients and innovation.' }],
}

const mockRawMdx = `---\ntitle: Taiwan Skincare Brands\n---\n\nContent here.`

describe('guides service (filesystem-backed)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getAllGuides', () => {
    it('returns guides with preserved nested frontmatter shape', async () => {
      vi.mocked(fs.readdirSync).mockReturnValue(['taiwan-skincare-brands.mdx'] as unknown as ReturnType<typeof fs.readdirSync>)
      vi.mocked(fs.readFileSync).mockReturnValue(mockRawMdx)
      vi.mocked(matter).mockReturnValue({ data: mockFrontmatter, content: 'Content here.' } as unknown as ReturnType<typeof matter>)

      const result = await getAllGuides()
      expect(result.ok).toBe(true)
      if (!result.ok) throw result.error
      const guides = result.guides

      expect(guides).toHaveLength(1)
      expect(guides[0].slug).toBe('taiwan-skincare-brands')
      expect(guides[0].frontmatter.title).toBe('Taiwan Skincare Brands')
      expect(guides[0].frontmatter.description).toBe('Top skincare brands from Taiwan')
      expect(guides[0].frontmatter.category).toBe('beauty')
      expect(guides[0].frontmatter.locale).toBe('zh-TW')
      expect(guides[0].frontmatter.publishedAt).toBe('2026-06-15T00:00:00.000Z')
      expect(guides[0].frontmatter.faq).toEqual([
        { q: 'What makes Taiwan skincare special?', a: 'High-quality ingredients and innovation.' },
      ])
      expect(guides[0].frontmatter.sources).toEqual(['https://example.com/source'])
      expect(guides[0].frontmatter.draft).toBe(false)
    })

    it('filters out non-zh-TW locale guides', async () => {
      vi.mocked(fs.readdirSync).mockReturnValue(['en-guide.mdx'] as unknown as ReturnType<typeof fs.readdirSync>)
      vi.mocked(fs.readFileSync).mockReturnValue(mockRawMdx)
      vi.mocked(matter).mockReturnValue({
        data: { ...mockFrontmatter, locale: 'en' },
        content: 'Content.',
      } as unknown as ReturnType<typeof matter>)

      const result = await getAllGuides()
      expect(result.ok).toBe(true)
      if (!result.ok) throw result.error
      expect(result.guides).toHaveLength(0)
    })

    it('filters out draft guides', async () => {
      vi.mocked(fs.readdirSync).mockReturnValue(['draft-guide.mdx'] as unknown as ReturnType<typeof fs.readdirSync>)
      vi.mocked(fs.readFileSync).mockReturnValue(mockRawMdx)
      vi.mocked(matter).mockReturnValue({
        data: { ...mockFrontmatter, draft: true },
        content: 'Content.',
      } as unknown as ReturnType<typeof matter>)

      const result = await getAllGuides()
      expect(result.ok).toBe(true)
      if (!result.ok) throw result.error
      expect(result.guides).toHaveLength(0)
    })

    it('handles missing optional fields with defaults', async () => {
      vi.mocked(fs.readdirSync).mockReturnValue(['taiwan-skincare-brands.mdx'] as unknown as ReturnType<typeof fs.readdirSync>)
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

      const result = await getAllGuides()
      expect(result.ok).toBe(true)
      if (!result.ok) throw result.error
      const guides = result.guides

      expect(guides[0].frontmatter.updatedAt).toBeUndefined()
      expect(guides[0].frontmatter.sources).toEqual([])
      expect(guides[0].frontmatter.faq).toEqual([])
      expect(guides[0].frontmatter.draft).toBe(false)
    })

    it('returns a failure result and logs filesystem errors', async () => {
      const error = new Error('ENOENT: directory not found')
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      vi.mocked(fs.readdirSync).mockImplementation(() => { throw error })

      const result = await getAllGuides()

      expect(result).toEqual({ ok: false, error })
      expect(consoleError).toHaveBeenCalledWith(
        '[guides:getAllGuides] filesystem read failed',
        error,
      )
      consoleError.mockRestore()
    })
  })

  describe('getGuideBySlug', () => {
    it('returns entry with preserved shape and raw content string', async () => {
      vi.mocked(fs.readFileSync).mockReturnValue(mockRawMdx)
      vi.mocked(matter).mockReturnValue({
        data: mockFrontmatter,
        content: 'Content here.',
      } as unknown as ReturnType<typeof matter>)

      const result = await getGuideBySlug('taiwan-skincare-brands')

      expect(result).not.toBeNull()
      if (!result) throw new Error('Expected guide detail result')
      expect(result.entry.slug).toBe('taiwan-skincare-brands')
      expect(result.entry.frontmatter.title).toBe('Taiwan Skincare Brands')
      expect(typeof result.content).toBe('string')
    })

    it('returns null when the file does not exist', async () => {
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      })

      const result = await getGuideBySlug('missing-guide')

      expect(result).toBeNull()
    })
  })

  describe('getPublishedGuideBySlug', () => {
    it('does not expose a draft guide through the public query', async () => {
      vi.mocked(fs.readFileSync).mockReturnValue(mockRawMdx)
      vi.mocked(matter).mockReturnValue({
        data: { ...mockFrontmatter, draft: true },
        content: 'Content.',
      } as unknown as ReturnType<typeof matter>)

      await expect(
        getPublishedGuideBySlug('taiwan-skincare-brands'),
      ).resolves.toBeNull()
    })

    it('returns the guide when it is published', async () => {
      vi.mocked(fs.readFileSync).mockReturnValue(mockRawMdx)
      vi.mocked(matter).mockReturnValue({
        data: { ...mockFrontmatter, draft: false },
        content: 'Content.',
      } as unknown as ReturnType<typeof matter>)

      const result = await getPublishedGuideBySlug('taiwan-skincare-brands')
      expect(result).not.toBeNull()
    })
  })

  describe('getGuidesByCategory', () => {
    it('filters by category, locale, and draft status', async () => {
      const files = ['beauty-guide.mdx', 'food-guide.mdx']
      vi.mocked(fs.readdirSync).mockReturnValue(files as unknown as ReturnType<typeof fs.readdirSync>)
      vi.mocked(fs.readFileSync)
        .mockReturnValueOnce(mockRawMdx)
        .mockReturnValueOnce(mockRawMdx)
      vi.mocked(matter)
        .mockReturnValueOnce({ data: { ...mockFrontmatter, slug: 'beauty-guide', category: 'beauty' }, content: 'content' } as unknown as ReturnType<typeof matter>)
        .mockReturnValueOnce({ data: { ...mockFrontmatter, slug: 'food-guide', category: 'food' }, content: 'content' } as unknown as ReturnType<typeof matter>)

      const result = await getGuidesByCategory('beauty')
      expect(result.ok).toBe(true)
      if (!result.ok) throw result.error
      expect(result.guides).toHaveLength(1)
      expect(result.guides[0].frontmatter.category).toBe('beauty')
    })
  })
})
