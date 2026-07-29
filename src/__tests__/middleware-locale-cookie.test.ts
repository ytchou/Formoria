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

  it('sets the cookie when the incoming cookie differs from the resolved locale', async () => {
    const res = await proxy(req('/en/about', { cookie: 'zh-TW' }))

    expect(res.cookies.get(LOCALE_COOKIE)?.value).toBe('en')
  })

  it('sets the cookie when there is no incoming cookie', async () => {
    const res = await proxy(req('/about', { acceptLanguage: 'zh-TW,zh;q=0.9' }))

    expect(res.cookies.get(LOCALE_COOKIE)?.value).toBe('zh-TW')
  })

  it('never sets the cookie on internal router requests', async () => {
    const res = await proxy(
      req('/en/about', { cookie: 'zh-TW', extraHeaders: { RSC: '1' } }),
    )

    expect(res.cookies.get(LOCALE_COOKIE)).toBeUndefined()
  })

  it('still sets en on the locale redirect for a first-time English visitor', async () => {
    const res = await proxy(req('/about', { acceptLanguage: 'en-US,en;q=0.9' }))

    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('/en/about')
    expect(res.cookies.get(LOCALE_COOKIE)?.value).toBe('en')
  })

  it('marks the first-time locale redirect as private and uncacheable', async () => {
    const res = await proxy(req('/about', { acceptLanguage: 'en-US,en;q=0.9' }))

    expect(res.status).toBe(307)
    expect(res.headers.get('cache-control')).toBe('private, no-store')
  })

  it('does NOT redirect a Taiwan visitor whose browser is in English', async () => {
    const res = await proxy(
      req('/about', {
        acceptLanguage: 'en-US,en;q=0.9',
        extraHeaders: { 'cf-ipcountry': 'TW' },
      }),
    )

    expect(res.status).not.toBe(307)
    expect(res.cookies.get(LOCALE_COOKIE)?.value).toBe('zh-TW')
  })

  it('never geo-redirects a crawler', async () => {
    const res = await proxy(
      req('/about', {
        acceptLanguage: 'en-US,en;q=0.9',
        extraHeaders: { 'cf-ipcountry': 'TW', 'user-agent': 'Googlebot/2.1' },
      }),
    )

    expect(res.status).not.toBe(307)
  })
})
