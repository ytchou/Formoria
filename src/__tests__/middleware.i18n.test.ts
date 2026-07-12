import { describe, it, expect, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { middleware } from '@/middleware'

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
  it('does not slug-redirect a locale prefix to /brands/<locale>', async () => {
    const res = await middleware(req('/en'))
    const loc = res?.headers.get('location') ?? ''
    expect(loc).not.toContain('/brands/en')
  })

  it('still slug-redirects a bare slug to /brands/:slug', async () => {
    const res = await middleware(req('/some-brand-slug'))
    expect(res?.headers.get('location') ?? '').toContain('/brands/some-brand-slug')
  })

  it('does not redirect a reserved public path like /brands', async () => {
    const res = await middleware(req('/brands'))
    const loc = res?.headers.get('location') ?? ''
    expect(loc).not.toContain('/brands/brands')
    expect(loc).toContain('/en/brands')
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
      const res = await middleware(req('/brands', {
        'accept-language': 'en-US,en;q=0.9',
        'user-agent': ua,
      }))
      expect(res?.headers.get('location')).toBeNull()
    }
  })
})
