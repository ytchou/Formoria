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
      website: 'https://example.com',
      region: 'taipei',
      valueTags: [],
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing region (required)', () => {
    const schema = getBrandInfoSchema(t)
    const result = schema.safeParse({
      name: 'Test Brand',
      description: 'A'.repeat(40),
      category: 'fashion',
      website: 'https://example.com',
    })
    expect(result.success).toBe(false)
  })

  it('rejects more than 3 valueTags', () => {
    const schema = getBrandInfoSchema(t)
    const result = schema.safeParse({
      name: 'Test Brand',
      description: 'A'.repeat(40),
      category: 'fashion',
      website: 'https://example.com',
      region: 'taipei',
      valueTags: ['a', 'b', 'c', 'd'],
    })
    expect(result.success).toBe(false)
  })

  it('accepts up to 3 valueTags', () => {
    const schema = getBrandInfoSchema(t)
    const result = schema.safeParse({
      name: 'Test Brand',
      description: 'A'.repeat(40),
      category: 'fashion',
      website: 'https://example.com',
      region: 'taipei',
      valueTags: ['sustainability', 'fair-trade', 'organic'],
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
