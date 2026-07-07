import { describe, expect, it } from 'vitest'
import type { Brand } from '@/lib/types'
import { buildBrandEditDefaultValues } from './brand-edit-defaults'

describe('buildBrandEditDefaultValues', () => {
  it('removes database nulls that invalidate optional form fields', () => {
    const defaults = buildBrandEditDefaultValues({
      name: 'Brand One',
      description: null,
      city: null,
      foundingYear: null,
      priceRange: null,
      reputationSummary: null,
    } as Brand)

    expect(defaults.name).toBe('Brand One')
    expect(defaults).not.toHaveProperty('description')
    expect(defaults).not.toHaveProperty('city')
    expect(defaults).not.toHaveProperty('foundingYear')
    expect(defaults).not.toHaveProperty('priceRange')
  })

  it('maps stored reputation data into wizard fields', () => {
    const defaults = buildBrandEditDefaultValues({
      reputationSummary: {
        text: 'Well reviewed',
        sources: [{ url: 'https://example.com/review' }],
      },
    } as Brand)

    expect(defaults.reputationSummary).toBe('Well reviewed')
    expect(defaults.reputationSources).toEqual([{ url: 'https://example.com/review' }])
  })
})
