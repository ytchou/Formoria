import path from 'path'
import { describe, expect, it } from 'vitest'
import {
  getAllGuides,
  getGuideBySlug,
  getGuidesByCategory,
  guideFrontmatterSchema,
} from './guides'

const FIXTURE_DIR = path.join(process.cwd(), 'content/guides/__fixtures__')

describe('guideFrontmatterSchema', () => {
  const validFrontmatter = {
    title: '台灣護膚品牌推薦',
    description: '精選台灣製造護膚品牌',
    slug: 'skincare-brands',
    category: 'beauty',
    locale: 'zh-TW',
    publishedAt: '2026-07-01',
  }

  it('validates correct frontmatter with all required fields', () => {
    expect(guideFrontmatterSchema.safeParse(validFrontmatter).success).toBe(true)
  })

  it('validates frontmatter with optional fields', () => {
    const result = guideFrontmatterSchema.safeParse({
      ...validFrontmatter,
      updatedAt: '2026-07-02',
      sources: ['https://example.com'],
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing title', () => {
    expect(
      guideFrontmatterSchema.safeParse({
        description: validFrontmatter.description,
        slug: validFrontmatter.slug,
        category: validFrontmatter.category,
        locale: validFrontmatter.locale,
        publishedAt: validFrontmatter.publishedAt,
      }).success,
    ).toBe(false)
  })

  it('rejects missing slug', () => {
    expect(
      guideFrontmatterSchema.safeParse({
        title: validFrontmatter.title,
        description: validFrontmatter.description,
        category: validFrontmatter.category,
        locale: validFrontmatter.locale,
        publishedAt: validFrontmatter.publishedAt,
      }).success,
    ).toBe(false)
  })

  it('rejects invalid locale', () => {
    expect(
      guideFrontmatterSchema.safeParse({ ...validFrontmatter, locale: 'en' }).success,
    ).toBe(false)
  })

  it('rejects invalid category', () => {
    expect(
      guideFrontmatterSchema.safeParse({ ...validFrontmatter, category: 'invalid-cat' })
        .success,
    ).toBe(false)
  })

  it('rejects missing publishedAt', () => {
    expect(
      guideFrontmatterSchema.safeParse({
        title: validFrontmatter.title,
        description: validFrontmatter.description,
        slug: validFrontmatter.slug,
        category: validFrontmatter.category,
        locale: validFrontmatter.locale,
      }).success,
    ).toBe(false)
  })
})

describe('getAllGuides', () => {
  it('returns all guides from the content directory', async () => {
    const guides = await getAllGuides(FIXTURE_DIR)
    expect(guides).toHaveLength(2)
    expect(guides[0]).toHaveProperty('frontmatter')
    expect(guides[0].frontmatter).toHaveProperty('title')
    expect(guides[0].frontmatter).toHaveProperty('slug')
  })

  it('sorts guides by publishedAt descending (newest first)', async () => {
    const guides = await getAllGuides(FIXTURE_DIR)
    expect(guides[0].frontmatter.slug).toBe('test-skincare-brands')
    expect(guides[1].frontmatter.slug).toBe('test-tea-brands')
  })

  it('returns empty array for non-existent directory', async () => {
    const guides = await getAllGuides('/non/existent/path')
    expect(guides).toEqual([])
  })
})

describe('getGuideBySlug', () => {
  it('returns guide with matching slug', async () => {
    const guide = await getGuideBySlug('test-skincare-brands', FIXTURE_DIR)
    expect(guide).not.toBeNull()
    expect(guide!.frontmatter.slug).toBe('test-skincare-brands')
    expect(guide!.frontmatter.title).toBe('台灣護膚品牌推薦')
  })

  it('includes raw MDX content', async () => {
    const guide = await getGuideBySlug('test-skincare-brands', FIXTURE_DIR)
    expect(guide!.content).toContain('台灣護膚品牌推薦')
    expect(guide!.content).toContain('<BrandCard')
  })

  it('returns null for non-existent slug', async () => {
    const guide = await getGuideBySlug('non-existent', FIXTURE_DIR)
    expect(guide).toBeNull()
  })
})

describe('getGuidesByCategory', () => {
  it('returns guides matching the category', async () => {
    const guides = await getGuidesByCategory('beauty', FIXTURE_DIR)
    expect(guides).toHaveLength(1)
    expect(guides[0].frontmatter.category).toBe('beauty')
  })

  it('returns empty array for category with no guides', async () => {
    const guides = await getGuidesByCategory('tech', FIXTURE_DIR)
    expect(guides).toEqual([])
  })
})
