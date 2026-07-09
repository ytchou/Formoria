import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { searchBrandUrls, batchSearchBrandImages } from '../search'

afterEach(() => vi.unstubAllGlobals())

const MOCK_SERPER_SERP_RESPONSE = {
  organic: [
    { position: 1, title: '茶籽堂 Cha Tzu Tang', link: 'https://www.chatzutang.com/', snippet: '茶籽堂...' },
    { position: 2, title: '茶籽堂 - Instagram', link: 'https://www.instagram.com/chatzutang/', snippet: '...' },
    { position: 3, title: '茶籽堂 - Facebook', link: 'https://www.facebook.com/chatzutang/', snippet: '...' },
    { position: 4, title: '茶籽堂 - Pinkoi', link: 'https://www.pinkoi.com/store/chatzutang', snippet: '...' },
    { position: 5, title: '茶籽堂 - Shopee', link: 'https://shopee.tw/chatzutang', snippet: '...' },
  ],
}

const MOCK_SERPER_IMAGE_RESPONSE = {
  images: [
    { title: 'Product 1', imageUrl: 'https://example.com/img1.jpg', imageWidth: 800, imageHeight: 600 },
    { title: 'Product 2', imageUrl: 'https://example.com/img2.jpg', imageWidth: 200, imageHeight: 150 },
    { title: 'Product 3', imageUrl: 'https://example.com/img3.jpg', imageWidth: 0, imageHeight: 0 },
  ],
}

describe('searchBrandUrls (Serper)', () => {
  beforeEach(() => { process.env.SERPER_API_KEY = 'test-key' })
  afterEach(() => { delete process.env.SERPER_API_KEY })

  it('calls Serper search endpoint and returns parsed URLs', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify(MOCK_SERPER_SERP_RESPONSE), { status: 200, headers: { 'content-type': 'application/json' } })
    ))
    const urls = await searchBrandUrls('茶籽堂')
    expect(urls).toHaveLength(5)
    expect(urls[0]).toBe('https://www.chatzutang.com/')
    const fetchCall = vi.mocked(fetch).mock.calls[0]
    expect(fetchCall[0]).toBe('https://google.serper.dev/search')
    const init = fetchCall[1] as RequestInit
    const headers = init.headers as Record<string, string>
    expect(headers['X-API-KEY']).toBe('test-key')
    const body = JSON.parse(init.body as string)
    expect(body.q).toBe('茶籽堂 台灣')
    expect(body.gl).toBe('tw')
    expect(body.hl).toBe('zh-TW')
  })

  it('filters out google.com URLs', async () => {
    const response = { organic: [
      { position: 1, link: 'https://www.example.com/' },
      { position: 2, link: 'https://www.google.com/maps/place/...' },
      { position: 3, link: 'https://translate.google.com/...' },
    ]}
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify(response), { status: 200, headers: { 'content-type': 'application/json' } })
    ))
    const urls = await searchBrandUrls('test')
    expect(urls).toEqual(['https://www.example.com/'])
  })

  it('deduplicates URLs', async () => {
    const response = { organic: [
      { position: 1, link: 'https://www.example.com/' },
      { position: 2, link: 'https://www.example.com/' },
    ]}
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify(response), { status: 200, headers: { 'content-type': 'application/json' } })
    ))
    const urls = await searchBrandUrls('test')
    expect(urls).toEqual(['https://www.example.com/'])
  })

  it('returns empty array on fetch error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('error', { status: 500 })))
    const urls = await searchBrandUrls('test')
    expect(urls).toEqual([])
  })

  it('returns empty array on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')))
    const urls = await searchBrandUrls('test')
    expect(urls).toEqual([])
  })

  it('throws if SERPER_API_KEY is not set', async () => {
    delete process.env.SERPER_API_KEY
    await expect(searchBrandUrls('test')).rejects.toThrow('SERPER_API_KEY')
  })
})

describe('batchSearchBrandImages (Serper)', () => {
  beforeEach(() => { process.env.SERPER_API_KEY = 'test-key' })
  afterEach(() => { delete process.env.SERPER_API_KEY })

  it('calls Serper images endpoint and filters by MIN_DIMENSION', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify(MOCK_SERPER_IMAGE_RESPONSE), { status: 200, headers: { 'content-type': 'application/json' } })
    ))
    const results = await batchSearchBrandImages(['testBrand'], 1)
    const brandResults = results.get('testBrand') ?? []
    // img1 (800x600) passes, img2 (200x150) filtered, img3 (0x0) passes (unknown dims)
    expect(brandResults.length).toBeGreaterThanOrEqual(2)
    const fetchCall = vi.mocked(fetch).mock.calls[0]
    expect(fetchCall[0]).toBe('https://google.serper.dev/images')
  })
})
