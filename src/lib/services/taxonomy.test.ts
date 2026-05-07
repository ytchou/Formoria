import { describe, it, expect } from 'vitest'
import { tagToDomain, tagToInsert } from './taxonomy'

describe('tagToDomain', () => {
  it('transforms snake_case DB row to camelCase TaxonomyTag', () => {
    const dbRow = {
      id: 'tag-1',
      name: 'Organic',
      name_zh: '有機',
      slug: 'organic',
      category: 'material',
      is_active: true,
      suggested_by: null,
      created_at: '2026-01-01T00:00:00Z',
    }

    const tag = tagToDomain(dbRow)

    expect(tag.id).toBe('tag-1')
    expect(tag.name).toBe('Organic')
    expect(tag.nameZh).toBe('有機')
    expect(tag.slug).toBe('organic')
    expect(tag.category).toBe('material')
    expect(tag.isActive).toBe(true)
    expect(tag.suggestedBy).toBeNull()
    expect(tag.createdAt).toBe('2026-01-01T00:00:00Z')
  })
})

describe('tagToInsert', () => {
  it('transforms camelCase domain data to snake_case DB row', () => {
    const input = {
      name: 'Handmade',
      nameZh: '手工',
      slug: 'handmade',
      category: 'material' as const,
    }

    const row = tagToInsert(input)

    expect(row.name).toBe('Handmade')
    expect(row.name_zh).toBe('手工')
    expect(row.slug).toBe('handmade')
    expect(row.category).toBe('material')
    expect(row).not.toHaveProperty('nameZh')
  })
})
