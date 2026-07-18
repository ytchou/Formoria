import { describe, it, expect, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { proxy } from '@/proxy'

vi.mock('next-intl/middleware', () => ({
  default: vi.fn(() => () => NextResponse.next()),
}))

vi.mock('@/i18n/routing', () => ({
  routing: {
    locales: ['zh-TW', 'en'],
    defaultLocale: 'zh-TW',
  },
}))

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
    },
  })),
}))

function req(path: string, headers?: HeadersInit) {
  return new NextRequest(new URL(`https://x.test${path}`), { headers })
}

describe('i18n middleware composition', () => {
  it('defaults admin requests to English', async () => {
    const res = await proxy(req('/admin/submissions'))

    expect(res?.headers.get('x-middleware-request-x-next-intl-locale')).toBe('en')
  })

  it('does not slug-redirect a locale prefix to /brands/<locale>', async () => {
    const res = await proxy(req('/en'))
    const loc = res?.headers.get('location') ?? ''
    expect(loc).not.toContain('/brands/en')
  })

  it('still slug-redirects a bare slug to /brands/:slug', async () => {
    const res = await proxy(req('/some-brand-slug'))
    expect(res?.headers.get('location') ?? '').toContain('/brands/some-brand-slug')
  })

  it('does not redirect a reserved public path like /brands', async () => {
    const res = await proxy(req('/brands'))
    const loc = res?.headers.get('location') ?? ''
    expect(loc).not.toContain('/brands/brands')
    expect(loc).toContain('/en/brands')
  })

  it('permanently normalizes uppercase public paths', async () => {
    const res = await proxy(req('/Brands'))

    expect(res?.status).toBe(301)
    expect(res?.headers.get('location')).toContain('/brands')
  })

  it('does not locale-redirect prefix-free public paths for known crawlers', async () => {
    const bots = [
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
      'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
      'Twitterbot/1.0',
      'Mozilla/5.0 AppleWebKit/537.36 (compatible; GPTBot/1.0)',
      'Mozilla/5.0 (compatible; PerplexityBot/1.0)',
    ]

    for (const ua of bots) {
      const res = await proxy(req('/brands', {
        'accept-language': 'en-US,en;q=0.9',
        'user-agent': ua,
      }))
      expect(res?.headers.get('location')).toBeNull()
    }
  })
  it.each([
    ['an RSC response', { RSC: '1' }],
    ['a router prefetch', { 'next-router-prefetch': '1' }],
    ['a Server Action response', { 'next-action': 'action-id' }],
    ['a Next router request', { 'next-url': '/en/brands' }],
    ['a router fetch without internal headers', { accept: '*/*' }],
  ])('does not overwrite the locale cookie from %s', async (_, headers) => {
    const res = await proxy(req('/en/brands', headers))

    expect(res?.cookies.get('NEXT_LOCALE')).toBeUndefined()
  })

  it('does not set a locale cookie on an inferred-locale RSC redirect', async () => {
    const res = await proxy(
      req('/brands', { RSC: '1', 'accept-language': 'en-US,en;q=0.9' }),
    )

    expect(res?.headers.get('location')).toContain('/en/brands')
    expect(res?.cookies.get('NEXT_LOCALE')).toBeUndefined()
  })

  it('sets the locale cookie for a document response', async () => {
    const res = await proxy(req('/en/brands'))

    expect(res?.cookies.get('NEXT_LOCALE')?.value).toBe('en')
  })
})
