import { describe, expect, it } from 'vitest'
import { CATEGORY_ONTOLOGY, parentGroupForSlug } from '../ontology'

describe('taxonomy ontology', () => {
  it('groups product_type slugs under parent groups', () => {
    expect(Object.keys(CATEGORY_ONTOLOGY).length).toBeGreaterThan(0)
    for (const [parent, slugs] of Object.entries(CATEGORY_ONTOLOGY)) {
      expect(parent).toMatch(/^[a-z-]+$/)
      expect(Array.isArray(slugs)).toBe(true)
    }
  })

  it('resolves a known slug to its parent group', () => {
    const [parent, slugs] = Object.entries(CATEGORY_ONTOLOGY)[0]
    expect(parentGroupForSlug(slugs[0])).toBe(parent)
  })

  it('returns null for an unknown slug', () => {
    expect(parentGroupForSlug('__not-a-real-slug__')).toBeNull()
  })
})
