import { describe, expect, it } from 'vitest'
import { sanitizeHref } from './url'

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
