import { describe, expect, it } from 'vitest'
import { getProductTypeLabel } from '../category-label'

describe('getProductTypeLabel', () => {
  it('returns zh-TW label for known slug', () => {
    expect(getProductTypeLabel('fashion')).toBe('服飾鞋履')
    expect(getProductTypeLabel('food-drink')).toBe('食品飲料')
  })

  it('returns EN label when locale is en', () => {
    expect(getProductTypeLabel('fashion', 'en')).toBe('Fashion & Apparel')
  })

  it('returns undefined for unknown slug', () => {
    expect(getProductTypeLabel('clothing')).toBeUndefined() // old slug
    expect(getProductTypeLabel('footwear')).toBeUndefined()
  })
})
