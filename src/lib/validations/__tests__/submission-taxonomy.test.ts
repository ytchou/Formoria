import { describe, it, expect } from 'vitest'
import { createSubmissionSchema, getBrandInfoSchema } from '../submission'

const t = (key: string) => key

describe('submission schema — taxonomy fields', () => {
  it('accepts valid brand info without region', () => {
    const schema = getBrandInfoSchema(t)
    const result = schema.safeParse({
      name: 'Test Brand',
      website: 'https://example.com',
    })
    expect(result.success).toBe(true)
  })

  it('createSubmissionSchema does not include region', () => {
    const schema = createSubmissionSchema(true, t)
    const shape = schema.shape
    expect(shape).not.toHaveProperty('region')
    expect(shape).not.toHaveProperty('tags')
    expect(shape).not.toHaveProperty('valueTags')
  })
})
