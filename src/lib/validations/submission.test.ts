import { describe, test, expect } from 'vitest'
import { createOwnerSubmissionSchema, getLinksSchema } from './submission'

const t = (key: string) => key

describe('linksSchema — URL schemes', () => {
  const baseLinks = {
    socialLinks: {
      instagram: '',
      threads: '',
      facebook: '',
      website: '',
    },
  }

  test.each([
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
  ])('rejects unsafe URL scheme %s', (url) => {
    const result = getLinksSchema(t).safeParse({
      ...baseLinks,
      purchaseLinks: [{ platform: 'Website', url }],
    })

    expect(result.success).toBe(false)
  })

  test.each(['https://example.com', 'http://example.com'])(
    'accepts HTTP URL scheme %s',
    (url) => {
      const result = getLinksSchema(t).safeParse({
        ...baseLinks,
        purchaseLinks: [{ platform: 'Website', url }],
      })

      expect(result.success).toBe(true)
    },
  )
})

describe('owner submission schema', () => {
  test('requires description and hero image', () => {
    const result = createOwnerSubmissionSchema(t).safeParse({
      name: 'Owner Brand',
      website: 'https://owner.example',
      description: '',
      heroImageUrl: '',
      pdpaConsent: true,
      turnstileToken: 'token',
      honeypot: '',
    })

    expect(result.success).toBe(false)
  })
})
