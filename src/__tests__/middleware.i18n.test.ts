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

function req(path: string) {
  return new NextRequest(new URL(`https://x.test${path}`))
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
  })
})
