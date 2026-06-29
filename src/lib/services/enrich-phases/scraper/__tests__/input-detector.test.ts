import { describe, it, expect, vi, afterEach } from 'vitest'
import { classifyByDomain, detectInputType } from '../input-detector'

afterEach(() => vi.unstubAllGlobals())

function html(body: string) {
  return new Response(body, { status: 200, headers: { 'content-type': 'text/html' } })
}

describe('classifyByDomain', () => {
  it('maps known hosts', () => {
    expect(classifyByDomain('https://www.instagram.com/brand')).toBe('social')
    expect(classifyByDomain('https://pinkoi.com/store/x')).toBe('e-commerce')
    expect(classifyByDomain('https://my-brand.com')).toBeNull()
  })
})

describe('detectInputType', () => {
  it('returns deep-multi-page when nav has many internal sections', async () => {
    const nav = '<nav>' + ['/about','/products','/story','/contact'].map(h => `<a href="${h}">x</a>`).join('') + '</nav>'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(html(`<html><body>${nav}</body></html>`)))
    await expect(detectInputType('https://brand.com')).resolves.toBe('deep-multi-page')
  })
  it('returns official-site for a sparse landing page', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(html('<html><body><h1>Hi</h1></body></html>')))
    await expect(detectInputType('https://brand.com')).resolves.toBe('official-site')
  })
})
