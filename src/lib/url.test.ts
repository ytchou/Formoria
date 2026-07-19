import { describe, expect, it } from 'vitest'
import {
  isPrivateUrl,
  normalizeInstagramHref,
  normalizeThreadsHref,
  sanitizeHref,
} from './url'

describe('isPrivateUrl', () => {
  it.each([
    'http://localhost',
    'http://127.0.0.1',
    'http://[::1]',
    'http://10.0.0.1',
    'http://172.16.0.1',
    'http://192.168.1.1',
    'http://169.254.1.1',
  ])('blocks private URL %s', (url) => {
    expect(isPrivateUrl(url)).toBe(true)
  })

  it('allows public HTTP URLs', () => {
    expect(isPrivateUrl('https://example.com')).toBe(false)
  })
})

describe('sanitizeHref', () => {
  it('returns null for null, undefined, empty string', () => {
    expect(sanitizeHref(null)).toBeNull()
    expect(sanitizeHref(undefined)).toBeNull()
    expect(sanitizeHref('')).toBeNull()
    expect(sanitizeHref('   ')).toBeNull()
  })

  it('passes through valid https URLs', () => {
    expect(sanitizeHref('https://example.com')).toBe('https://example.com')
    expect(sanitizeHref('https://facebook.com/brand')).toBe('https://facebook.com/brand')
  })

  it('passes through valid http URLs', () => {
    expect(sanitizeHref('http://example.com')).toBe('http://example.com')
  })

  it('prepends https:// for bare hostnames', () => {
    expect(sanitizeHref('facebook.com/brand')).toBe('https://facebook.com/brand')
    expect(sanitizeHref('pinkoi.com/store/xyz')).toBe('https://pinkoi.com/store/xyz')
  })

  it('rejects javascript: URLs', () => {
    expect(sanitizeHref('javascript:alert(1)')).toBeNull()
    expect(sanitizeHref('JAVASCRIPT:alert(1)')).toBeNull()
    expect(sanitizeHref('JavaScript:void(0)')).toBeNull()
  })

  it('rejects data: URLs', () => {
    expect(sanitizeHref('data:text/html,<script>alert(1)</script>')).toBeNull()
  })

  it('rejects vbscript: URLs', () => {
    expect(sanitizeHref('vbscript:MsgBox("xss")')).toBeNull()
  })

  it('trims whitespace', () => {
    expect(sanitizeHref('  https://example.com  ')).toBe('https://example.com')
  })
})

describe('normalizeInstagramHref', () => {
  it('normalizes handles and passes through safe URLs', () => {
    expect(normalizeInstagramHref('@warmwood.living')).toBe(
      'https://instagram.com/warmwood.living',
    )
    expect(normalizeInstagramHref('warmwood.living')).toBe(
      'https://instagram.com/warmwood.living',
    )
    expect(normalizeInstagramHref('https://instagram.com/warmwood')).toBe(
      'https://instagram.com/warmwood',
    )
  })
})

describe('normalizeThreadsHref', () => {
  it('normalizes handles and passes through safe URLs', () => {
    expect(normalizeThreadsHref('@warmwood.living')).toBe(
      'https://threads.net/@warmwood.living',
    )
    expect(normalizeThreadsHref('warmwood.living')).toBe(
      'https://threads.net/@warmwood.living',
    )
    expect(normalizeThreadsHref('https://threads.net/@warmwood')).toBe(
      'https://threads.net/@warmwood',
    )
  })
})
