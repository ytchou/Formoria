import { describe, it, expect } from 'vitest'
import { z } from 'zod/v3'
import { createSubmissionSchema } from '../submission'

const t = (key: string) => key

describe('submission schema city validation', () => {
  const baseSubmission = {
    name: '品牌名稱',
    website: 'https://example.com',
    pdpaConsent: true,
    turnstileToken: 'token',
    isOwner: true,
  }

  it('accepts undefined city (optional field)', () => {
    const schema = createSubmissionSchema(true, t)
    const result = schema.safeParse({
      ...baseSubmission,
      city: undefined,
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.city).toBeUndefined()
    }
  })

  it('accepts a valid city slug', () => {
    const schema = createSubmissionSchema(true, t)
    const result = schema.safeParse({
      ...baseSubmission,
      city: 'taipei',
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.city).toBe('taipei')
      expect(z.enum(['taipei'] as const).safeParse(result.data.city).success).toBe(true)
    }
  })

  it('rejects an invalid city slug', () => {
    const schema = createSubmissionSchema(true, t)
    const result = schema.safeParse({
      ...baseSubmission,
      city: 'new_york',
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some(issue => issue.path.join('.') === 'city')).toBe(true)
    }
  })
})
