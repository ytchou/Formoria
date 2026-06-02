import { describe, it, expect, vi } from 'vitest'

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
    },
  })),
}))

vi.mock('next/server', () => {
  const NextResponse = {
    next: vi.fn(() => ({
      cookies: { set: vi.fn() },
    })),
    redirect: vi.fn(),
  }
  return { NextResponse }
})

vi.mock('next-intl/middleware', () => ({
  default: vi.fn(() => vi.fn()),
}))

vi.mock('@/i18n/routing', () => ({
  routing: {
    locales: ['zh-TW', 'en'],
    defaultLocale: 'zh-TW',
  },
}))

vi.mock('@/lib/security/rate-limiter', () => ({
  checkRateLimit: vi.fn(() => null),
}))

import { RESERVED_ROUTES } from './middleware'

describe('RESERVED_ROUTES', () => {
  it('includes all known static route prefixes', () => {
    const expected = [
      'admin', 'api', 'auth', 'submit', 'categories',
      'category', 'brands', 'dashboard', 'faq', 'about',
      'my-submissions', 'global-error',
      'sitemap.xml', 'robots.txt', 'favicon.ico',
    ]
    for (const route of expected) {
      expect(RESERVED_ROUTES.has(route)).toBe(true)
    }
  })

  it('does not include brand-like slugs', () => {
    expect(RESERVED_ROUTES.has('cha-zi-tang')).toBe(false)
    expect(RESERVED_ROUTES.has('daylily')).toBe(false)
  })
})
