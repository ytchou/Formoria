import { describe, expect, it } from 'vitest'
import { SOURCE_BUCKETS, bucketSource, normalizeSource } from '../source-bucket'

const HOST = 'formoria.com'

describe('bucketSource', () => {
  it('prefers a valid in-app source (internal nav)', () => {
    expect(bucketSource('category', 'https://www.google.com/', HOST)).toBe('category')
    expect(bucketSource('search', '', HOST)).toBe('search')
    expect(bucketSource('directory', 'https://t.co/abc', HOST)).toBe('directory')
    expect(bucketSource('recommendation', '', HOST)).toBe('recommendation')
  })

  it('ignores in-app "direct"/undefined and falls back to referrer classification', () => {
    expect(bucketSource('direct', 'https://www.google.com/search?q=x', HOST)).toBe('external_search')
    expect(bucketSource(undefined, 'https://www.instagram.com/p/1', HOST)).toBe('social')
  })

  it('classifies an empty referrer as direct', () => {
    expect(bucketSource(undefined, '', HOST)).toBe('direct')
  })

  it('classifies a same-host referrer as direct (untagged internal)', () => {
    expect(bucketSource(undefined, 'https://formoria.com/brands', HOST)).toBe('direct')
  })

  it('classifies search engines as external_search', () => {
    expect(bucketSource(undefined, 'https://www.bing.com/', HOST)).toBe('external_search')
    expect(bucketSource(undefined, 'https://duckduckgo.com/', HOST)).toBe('external_search')
  })

  it('classifies social hosts as social', () => {
    expect(bucketSource(undefined, 'https://www.threads.net/@x', HOST)).toBe('social')
    expect(bucketSource(undefined, 'https://m.facebook.com/', HOST)).toBe('social')
  })

  it('classifies any other external host as external', () => {
    expect(bucketSource(undefined, 'https://some-blog.example/post', HOST)).toBe('external')
  })

  it('never throws on a malformed referrer', () => {
    expect(bucketSource(undefined, 'not a url', HOST)).toBe('direct')
  })
})

describe('normalizeSource', () => {
  it('passes through known buckets', () => {
    for (const b of SOURCE_BUCKETS) expect(normalizeSource(b)).toBe(b)
  })
  it('coerces unknown/invalid input to direct', () => {
    expect(normalizeSource('unknown')).toBe('direct') // client must never send unknown
    expect(normalizeSource('garbage')).toBe('direct')
    expect(normalizeSource(undefined)).toBe('direct')
    expect(normalizeSource(42)).toBe('direct')
  })
})
