import { describe, expect, it } from 'vitest'
import {
  getPublicOrigin,
  isPrivateUrl,
  normalizeInstagramHref,
  normalizeThreadsHref,
  normalizeToRootUrl,
  safeDecodeSlug,
  sanitizeHref,
} from './url'

describe('getPublicOrigin', () => {
  function fakeRequest(url: string, headers: Record<string, string> = {}): Request {
    return { url, headers: new Headers(headers) } as unknown as Request
  }

  it('uses x-forwarded-host and x-forwarded-proto when present', () => {
    const req = fakeRequest('https://localhost:8080/foo', {
      'x-forwarded-host': 'formoria.com',
      'x-forwarded-proto': 'https',
    })
    expect(getPublicOrigin(req)).toBe('https://formoria.com')
  })

  it('prefers x-forwarded-host over host', () => {
    const req = fakeRequest('https://localhost:8080/foo', {
      host: 'internal.railway.app',
      'x-forwarded-host': 'formoria.com',
    })
    expect(getPublicOrigin(req)).toBe('https://formoria.com')
  })

  it('falls back to host header', () => {
    const req = fakeRequest('https://localhost:8080/foo', {
      host: 'formoria.com',
    })
    expect(getPublicOrigin(req)).toBe('https://formoria.com')
  })

  it('falls back to request.url origin when no host headers', () => {
    const req = fakeRequest('http://localhost:3000/foo')
    expect(getPublicOrigin(req)).toBe('http://localhost:3000')
  })

  it('defaults proto to https when x-forwarded-proto is absent', () => {
    const req = fakeRequest('http://localhost:8080/foo', {
      host: 'formoria.com',
    })
    expect(getPublicOrigin(req)).toBe('https://formoria.com')
  })
})

describe('isPrivateUrl', () => {
  it.each([
    'http://localhost',
    'http://127.0.0.1',
    'http://127.0.0.2',
    'http://[::1]',
    'http://[fc00::1]',
    'http://[fd12:3456::1]',
    'http://[fe80::1]',
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

describe('normalizeToRootUrl', () => {
  it('strips path from URLs', () => {
    expect(normalizeToRootUrl('https://www.example.com/about')).toBe('https://www.example.com')
    expect(normalizeToRootUrl('https://www.hh-tw.com/pages/journal')).toBe('https://www.hh-tw.com')
  })

  it('returns root URLs unchanged', () => {
    expect(normalizeToRootUrl('https://www.example.com')).toBe('https://www.example.com')
    expect(normalizeToRootUrl('https://www.example.com/')).toBe('https://www.example.com')
  })

  it('returns null for null/undefined', () => {
    expect(normalizeToRootUrl(null)).toBeNull()
    expect(normalizeToRootUrl(undefined)).toBeNull()
  })

  it('returns invalid strings as-is', () => {
    expect(normalizeToRootUrl('not-a-url')).toBe('not-a-url')
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

describe('safeDecodeSlug', () => {
  it('safeDecodeSlug_decodes_percent_encoded_segments', () => {
    expect(safeDecodeSlug('creative-expo-2026')).toBe('creative-expo-2026')
    expect(safeDecodeSlug('%E6%96%87%E5%8D%9A%E6%9C%83')).toBe('文博會')
    // A literal `+` is NOT a space in a path segment, unlike a query string.
    expect(safeDecodeSlug('a+b')).toBe('a+b')
  })

  it('safeDecodeSlug_returns_null_for_malformed_escapes', () => {
    // Bare `decodeURIComponent` throws `URIError` on each of these. Inside a
    // route that is a 500 through the error boundary (plus error-reporting
    // noise on every crawler probe) for what is really a "no such page".
    for (const bad of ['%zz', '%', '%E0%A4%A', '100%']) {
      expect(() => decodeURIComponent(bad)).toThrow(URIError)
      expect(safeDecodeSlug(bad)).toBeNull()
    }
  })
})
