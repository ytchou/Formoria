import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { proxy } from '@/proxy'
import { LOCALE_COOKIE } from '@/i18n/locale-preference'

const HOST = 'formoria.com'

function req(
  path: string,
  { cookie, acceptLanguage, extraHeaders }: {
    cookie?: string
    acceptLanguage?: string
    extraHeaders?: Record<string, string>
  } = {},
) {
  const headers: Record<string, string> = { host: HOST, ...extraHeaders }
  if (cookie) headers.cookie = `${LOCALE_COOKIE}=${cookie}`
  if (acceptLanguage) headers['accept-language'] = acceptLanguage

  return new NextRequest(new URL(`https://${HOST}${path}`), { headers })
}

describe('locale cookie is only written when it changes', () => {
  it('does NOT set the cookie when the incoming cookie already matches', async () => {
    const res = await proxy(req('/en/about', { cookie: 'en' }))

    expect(res.cookies.get(LOCALE_COOKIE)).toBeUndefined()
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('does NOT set the cookie when an unprefixed path resolves to the cookie locale', async () => {
    const res = await proxy(req('/about', { cookie: 'zh-TW' }))

    expect(res.cookies.get(LOCALE_COOKIE)).toBeUndefined()
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('does NOT persist a URL-derived locale over an existing preference', async () => {
    const res = await proxy(req('/en/about', { cookie: 'zh-TW' }))

    expect(res.cookies.get(LOCALE_COOKIE)).toBeUndefined()
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('does not set the cookie when a cookie-less visitor resolves to the default locale', async () => {
    const res = await proxy(req('/about', { acceptLanguage: 'zh-TW,zh;q=0.9' }))

    expect(res.cookies.get(LOCALE_COOKIE)).toBeUndefined()
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('never sets the cookie on internal router requests', async () => {
    const res = await proxy(
      req('/en/about', { cookie: 'zh-TW', extraHeaders: { RSC: '1' } }),
    )

    expect(res.cookies.get(LOCALE_COOKIE)).toBeUndefined()
  })

  // The regression guard for the removed locale inference: a prefix-free public
  // path is the default locale unconditionally, whatever the request headers
  // say. Anything that redirects here also varies the URL on headers the edge
  // does not key on.
  it.each<{ label: string; headers: Record<string, string> }>([
    { label: 'an English browser outside Taiwan', headers: {} },
    { label: 'an English browser in Taiwan', headers: { 'cf-ipcountry': 'TW' } },
    { label: 'an English browser reported by Vercel geo', headers: { 'x-vercel-ip-country': 'US' } },
    { label: 'a crawler', headers: { 'user-agent': 'Googlebot/2.1' } },
  ])(
    'never redirects a prefix-free public path for $label',
    async ({ headers }) => {
      const res = await proxy(
        req('/about', {
          acceptLanguage: 'en-US,en;q=0.9',
          extraHeaders: headers,
        }),
      )

      expect(res.status).not.toBe(307)
      expect(res.cookies.get(LOCALE_COOKIE)).toBeUndefined()
      expect(res.headers.get('set-cookie')).toBeNull()
    },
  )

  it.each(['/brands', '/en/brands', '/zh-TW/brands'])(
    'marks the exact %s directory document as edge-cacheable',
    async (path) => {
      const res = await proxy(req(path, { cookie: 'zh-TW' }))

      expect(res.headers.get('cache-control')).toBe(
        'public, s-maxage=3600, stale-while-revalidate=86400',
      )
      expect(res.headers.get('set-cookie')).toBeNull()
    },
  )

  it.each(['/brands/', '//brands', '/brands/example/extra'])(
    'does not mark the non-exact %s path as edge-cacheable',
    async (path) => {
      const res = await proxy(req(path, { cookie: 'zh-TW' }))

      expect(res.headers.get('cache-control')).not.toBe(
        'public, s-maxage=3600, stale-while-revalidate=86400',
      )
    },
  )

  it('marks the first cookie-less brand directory response edge-cacheable', async () => {
    const res = await proxy(req('/brands', { acceptLanguage: 'zh-TW,zh;q=0.9' }))

    expect(res.headers.get('set-cookie')).toBeNull()
    expect(res.headers.get('cache-control')).toBe(
      'public, s-maxage=3600, stale-while-revalidate=86400',
    )
  })

  it('directory filter view response is edge-cacheable for a cookie-carrying visitor', async () => {
    const res = await proxy(req('/brands?page=2&sort=newest', { cookie: 'zh-TW' }))

    expect(res.headers.get('cache-control')).toBe(
      'public, s-maxage=3600, stale-while-revalidate=86400',
    )
  })

  it('does not mark a brand directory router response as edge-cacheable', async () => {
    const res = await proxy(
      req('/brands', { cookie: 'zh-TW', extraHeaders: { RSC: '1' } }),
    )

    expect(res.headers.get('cache-control')).not.toBe(
      'public, s-maxage=3600, stale-while-revalidate=86400',
    )
  })
})
