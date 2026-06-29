import { describe, it, expect, vi, afterEach } from 'vitest'
import { isPrivateUrl, fetchHtml, resolveUrl } from '../fetch-guards'

afterEach(() => vi.unstubAllGlobals())

function htmlResponse(body: string) {
  return new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })
}

describe('isPrivateUrl', () => {
  it('blocks localhost and private ranges', () => {
    expect(isPrivateUrl('http://localhost')).toBe(true)
    expect(isPrivateUrl('http://127.0.0.1')).toBe(true)
    expect(isPrivateUrl('http://192.168.1.1')).toBe(true)
    expect(isPrivateUrl('https://example.com')).toBe(false)
  })
})

describe('resolveUrl', () => {
  it('resolves relative paths against the page URL', () => {
    expect(resolveUrl('/about', 'https://example.com/x')).toBe('https://example.com/about')
    expect(resolveUrl('mailto:a@b.com', 'https://example.com')).toBeNull()
  })
})

describe('fetchHtml', () => {
  it('returns html for an OK text/html response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(htmlResponse('<html><body>ok</body></html>')))
    await expect(fetchHtml('https://example.com')).resolves.toContain('<body>ok</body>')
  })
  it('returns null for a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('no', { status: 404 })))
    await expect(fetchHtml('https://example.com')).resolves.toBeNull()
  })
  it('returns null for a non-html content-type', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })))
    await expect(fetchHtml('https://example.com')).resolves.toBeNull()
  })
  it('returns null without fetching a private URL', async () => {
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    await expect(fetchHtml('http://127.0.0.1')).resolves.toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })
})
