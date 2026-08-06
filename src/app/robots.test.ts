import { describe, expect, it } from 'vitest'
import { CRAWLER_REGISTRY } from '@/lib/security/crawler-registry'
import robots, { CONTENT_SIGNAL } from './robots'

function getRules() {
  const rules = robots().rules
  return Array.isArray(rules) ? rules : [rules]
}

function getRule(userAgent: string) {
  return getRules().find((rule) => rule.userAgent === userAgent)
}

describe('robots', () => {
  it('wildcard rule is found by userAgent, not by index', () => {
    expect(getRule('*')).toEqual(expect.objectContaining({ userAgent: '*', allow: '/' }))
  })

  it('wildcard rule still disallows admin, api and auth paths', () => {
    const rule = getRule('*')
    expect(rule?.disallow).toEqual(expect.arrayContaining(['/admin', '/api/', '/auth/', '/en/auth/']))
  })

  it('wildcard rule still allows /submit', () => {
    expect(getRule('*')?.disallow).not.toContain('/submit')
  })

  it('disallows /challenge', () => {
    expect(getRule('*')?.disallow).toContain('/challenge')
  })

  it('emits a per-agent group for every registry entry', () => {
    for (const entry of CRAWLER_REGISTRY) {
      expect(getRule(entry.name)).toEqual({ userAgent: entry.name, allow: '/' })
    }
  })

  it('declares ai-train=no while allowing search', () => {
    expect(CONTENT_SIGNAL).toBe('ai-train=no, search=yes, ai-input=yes')
  })

  it('references sitemap.xml', () => {
    expect(robots().sitemap).toMatch(/\/sitemap\.xml$/)
  })
})
