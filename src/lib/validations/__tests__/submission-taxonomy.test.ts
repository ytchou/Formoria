import { describe, it, expect } from 'vitest'
import { createSubmissionSchema, getBrandInfoSchema } from '../submission'

const t = (key: string) => key

describe('submission schema — taxonomy fields', () => {
  it('accepts valid region slug', () => {
    const schema = getBrandInfoSchema(t)
    const result = schema.safeParse({
      name: 'Test Brand',
      description: 'A'.repeat(40),
      category: 'fashion',
      region: 'taipei',
      valueTags: [],
      logoUrl: 'https://example.com/logo.png',
    })
    expect(result.success).toBe(true)
  })

  it('accepts empty region (optional)', () => {
    const schema = getBrandInfoSchema(t)
    const result = schema.safeParse({
      name: 'Test Brand',
      description: 'A'.repeat(40),
      category: 'fashion',
      logoUrl: 'https://example.com/logo.png',
    })
    expect(result.success).toBe(true)
  })

  it('rejects more than 3 valueTags', () => {
    const schema = getBrandInfoSchema(t)
    const result = schema.safeParse({
      name: 'Test Brand',
      description: 'A'.repeat(40),
      category: 'fashion',
      valueTags: ['a', 'b', 'c', 'd'],
      logoUrl: 'https://example.com/logo.png',
    })
    expect(result.success).toBe(false)
  })

  it('accepts up to 3 valueTags', () => {
    const schema = getBrandInfoSchema(t)
    const result = schema.safeParse({
      name: 'Test Brand',
      description: 'A'.repeat(40),
      category: 'fashion',
      valueTags: ['sustainability', 'fair-trade', 'organic'],
      logoUrl: 'https://example.com/logo.png',
    })
    expect(result.success).toBe(true)
  })

  it('createSubmissionSchema includes region and valueTags, not tags', () => {
    const schema = createSubmissionSchema(true, t)
    const shape = schema.shape
    expect(shape).toHaveProperty('region')
    expect(shape).toHaveProperty('valueTags')
    expect(shape).not.toHaveProperty('tags')
  })
})
