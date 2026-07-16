import { describe, expect, it } from 'vitest'
import { slugifyRomanizedName, withSlugSuffix } from '../slug'

describe('romanized brand slugs', () => {
  it('normalizes public URL input to kebab case', () => {
    expect(slugifyRomanizedName("  Din Tai Fung's  ")).toBe('din-tai-fung-s')
  })

  it('limits slugs to the database-safe public URL length', () => {
    expect(slugifyRomanizedName('A'.repeat(100))).toHaveLength(80)
    expect(withSlugSuffix('a'.repeat(80), 12)).toHaveLength(80)
    expect(withSlugSuffix('a'.repeat(80), 12)).toMatch(/-12$/)
  })

  it('returns an empty slug when romanized metadata is cleared', () => {
    expect(slugifyRomanizedName('   ')).toBe('')
  })
})
