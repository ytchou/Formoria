import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { gzipSync } from 'node:zlib'
import { resetAuditEmitterForTests, setAuditWriteSeam, type AuditRecord } from '@/lib/audit'
import { isPrivateUrl, fetchHtml, fetchHtmlWithMetadata, fetchXml, resolveUrl } from '../fetch-guards'

let writes: AuditRecord[]

beforeEach(() => {
  writes = []
  setAuditWriteSeam(async (record) => {
    writes.push(record)
    return null
  })
})

afterEach(() => {
  resetAuditEmitterForTests()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function htmlResponse(body: string) {
  return new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })
}

function htmlResponseFrom(body: string, finalUrl: string) {
  const response = htmlResponse(body)
  Object.defineProperty(response, 'url', { value: finalUrl, configurable: true })
  return response
}

describe('redirect target guard', () => {
  it('rejects_redirect_to_private_host', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(htmlResponseFrom('<html>secret</html>', 'http://169.254.169.254/latest/meta-data')),
    )

    const result = await fetchHtmlWithMetadata('https://example.com')

    expect(result.text).toBeNull()
    expect(result.error).toContain('private URL')

    const finish = writes.find(
      (record) => record.operation === 'fetch_html_with_metadata' && record.status !== 'started',
    )
    expect(finish?.status).toBe('failed')
  })

  it('allows_redirect_to_public_host', async () => {
    const body = '<html><body>ok</body></html>'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(htmlResponseFrom(body, 'https://www.example.com/final')),
    )

    await expect(fetchHtml('https://example.com')).resolves.toBe(body)
  })

  it('tolerates_empty_response_url', async () => {
    const body = '<html><body>ok</body></html>'
    const response = htmlResponse(body)
    expect(response.url).toBe('')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))

    await expect(fetchHtml('https://example.com')).resolves.toBe(body)
  })
})

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

  it('fetchHtml writes a span carrying content-type and byte length', async () => {
    const body = '<html><body>ok</body></html>'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(htmlResponse(body)))

    await expect(fetchHtml('https://example.com')).resolves.toBe(body)

    const finish = writes.find(
      (record) => record.operation === 'fetch_html' && record.status === 'succeeded',
    )
    expect(finish).toBeDefined()
    expect(finish?.summary).toMatchObject({
      contentType: 'text/html; charset=utf-8',
      byteLength: new TextEncoder().encode(body).byteLength,
    })
  })

  it('fetchHtml signature is unchanged for all existing callers', async () => {
    const fetchWithExpectedSignature: (url: string) => Promise<string | null> = fetchHtml
    const body = '<html><body>ok</body></html>'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(htmlResponse(body)))

    await expect(fetchWithExpectedSignature('https://example.com')).resolves.toBe(body)
  })

  it('an over-cap response is recorded as truncated, not dropped', async () => {
    const body = 'a'.repeat(5 * 1024 * 1024 + 1)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(htmlResponse(body)))

    await expect(fetchHtml('https://example.com')).resolves.toBeNull()

    const finish = writes.find(
      (record) => record.operation === 'fetch_html' && record.status === 'empty',
    )
    expect(finish).toBeDefined()
    expect(finish?.summary).toMatchObject({
      truncated: true,
      byteLength: 5 * 1024 * 1024 + 1,
    })
  })

  it('a private-URL rejection produces a terminal span, not a retry', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    await expect(fetchHtml('http://127.0.0.1')).resolves.toBeNull()

    const finish = writes.find(
      (record) => record.operation === 'fetch_html' && record.status !== 'started',
    )
    expect(finish?.status).toBe('failed')
    expect(finish?.status).not.toBe('network_error')
    expect(finish?.status).not.toBe('timeout')
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('fetchXml', () => {
  it('rejects an invalid URL without throwing or fetching', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    await expect(fetchXml('not a URL')).resolves.toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('decodes an application/octet-stream sitemap ending in .xml.gz', async () => {
    const xml =
      '<?xml version="1.0"?><urlset><url><loc>https://www.clany.com.tw/SalePage/Index/12084942</loc></url></urlset>'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(gzipSync(xml), {
          status: 200,
          headers: { 'content-type': 'application/octet-stream' },
        }),
      ),
    )

    await expect(
      fetchXml('https://www.clany.com.tw/Sitemap/sitemap_ShopSalePage.xml.gz'),
    ).resolves.toBe(xml)
  })
})
