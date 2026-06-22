import { describe, expect, it } from 'vitest'
import { getFullSubmissionSchema } from '../submission'

const t = (key: string) => key

describe('simplified submission schema', () => {
  const schema = getFullSubmissionSchema(t)

  it('accepts minimal submission with only required fields', () => {
    const result = schema.safeParse({
      name: 'My Brand',
      website: 'https://mybrand.com',
      region: 'taipei',
      isOwner: true,
      pdpaConsent: true,
      turnstileToken: 'test-token',
    })
    expect(result.success).toBe(true)
  })

  it('does not require description', () => {
    const result = schema.safeParse({
      name: 'My Brand',
      website: 'https://mybrand.com',
      region: 'taipei',
      isOwner: true,
      pdpaConsent: true,
      turnstileToken: 'test-token',
    })
    expect(result.success).toBe(true)
  })

  it('does not require productType or productTypeNote', () => {
    const result = schema.safeParse({
      name: 'My Brand',
      website: 'https://mybrand.com',
      region: 'taipei',
      isOwner: true,
      pdpaConsent: true,
      turnstileToken: 'test-token',
    })
    expect(result.success).toBe(true)
  })

  it('does not require purchase links', () => {
    const result = schema.safeParse({
      name: 'My Brand',
      website: 'https://mybrand.com',
      region: 'taipei',
      isOwner: true,
      pdpaConsent: true,
      turnstileToken: 'test-token',
    })
    expect(result.success).toBe(true)
  })

  it('still requires website URL', () => {
    const result = schema.safeParse({
      name: 'My Brand',
      region: 'taipei',
      isOwner: true,
      pdpaConsent: true,
      turnstileToken: 'test-token',
    })
    expect(result.success).toBe(false)
  })

  it('still requires region', () => {
    const result = schema.safeParse({
      name: 'My Brand',
      website: 'https://mybrand.com',
      isOwner: true,
      pdpaConsent: true,
      turnstileToken: 'test-token',
    })
    expect(result.success).toBe(false)
  })

  it('requires sourceAttribution when isOwner is false', () => {
    const result = schema.safeParse({
      name: 'My Brand',
      website: 'https://mybrand.com',
      region: 'taipei',
      isOwner: false,
      pdpaConsent: true,
      turnstileToken: 'test-token',
    })
    expect(result.success).toBe(false)
  })
})
