import { describe, it, expect } from 'vitest'
import { selectStrategy } from '../router'

describe('selectStrategy', () => {
  it('returns single-page for official-site without directive', () => {
    const strategy = selectStrategy('official-site', 'https://brand.com')
    expect(strategy.type).toBe('official-site')
  })

  it('returns crawl strategy when directive overrides to deep-multi-page', () => {
    const withDirective = selectStrategy('official-site', 'https://brand.com', {
      strategy: 'deep-multi-page',
    })
    expect(withDirective.type).toBe('deep-multi-page')

    const withoutDirective = selectStrategy('official-site', 'https://brand.com')
    expect(withoutDirective.type).toBe('official-site')
  })

  it('returns platform-adapter when directive overrides to social', () => {
    const strategy = selectStrategy('official-site', 'https://brand.com', {
      strategy: 'social',
    })
    expect(strategy.type).toBe('social')
  })

  it('ignores directive when strategy is undefined', () => {
    const strategy = selectStrategy('deep-multi-page', 'https://brand.com', {})
    expect(strategy.type).toBe('deep-multi-page')
  })
})
