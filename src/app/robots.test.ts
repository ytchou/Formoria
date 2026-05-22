import { describe, it, expect } from 'vitest'
import robots from './robots'

describe('robots', () => {
  it('allows all user agents on /', () => {
    const result = robots()
    expect(result.rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userAgent: '*', allow: '/' }),
      ])
    )
  })

  it('disallows admin, api, auth, and submit paths', () => {
    const result = robots()
    const rule = Array.isArray(result.rules) ? result.rules[0] : result.rules
    expect(rule.disallow).toContain('/admin')
    expect(rule.disallow).toContain('/api/')
    expect(rule.disallow).toContain('/auth/')
    expect(rule.disallow).toContain('/submit')
  })

  it('references sitemap.xml', () => {
    const result = robots()
    expect(result.sitemap).toMatch(/\/sitemap\.xml$/)
  })
})
