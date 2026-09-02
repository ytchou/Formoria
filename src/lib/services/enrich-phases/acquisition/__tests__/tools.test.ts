import { describe, expect, it, vi } from 'vitest'
import { createAcquisitionTools, type AcquisitionToolDeps } from '../tools'

function makeDeps(overrides: Partial<AcquisitionToolDeps> = {}): AcquisitionToolDeps {
  return {
    fetchHtml: vi.fn().mockResolvedValue({ text: '<html><head><title>Test</title></head><body>Hello world</body></html>', status: 200, latencyMs: 100, error: null }),
    renderProvider: {
      fetchRendered: vi.fn().mockResolvedValue({ html: '<html><body>Rendered</body></html>', finalUrl: 'https://example.com', status: 200 }),
    },
    searchBrand: vi.fn().mockResolvedValue({ urls: ['https://found.example.com'], snippets: ['A brand'] }),
    ...overrides,
  }
}

describe('acquisition tools', () => {
  it('tool_refuses_url_outside_provenance_allowlist', async () => {
    const deps = makeDeps()
    const tools = createAcquisitionTools(deps, {
      knownUrls: new Set(['https://allowed.example.com']),
      discoveredUrls: new Set(),
    })
    const probeStatic = tools.find((t) => t.name === 'probe_static')!
    const result = await probeStatic.invoke({ url: 'https://evil.example' })
    expect(result).toEqual({ error: 'not_in_allowlist' })
    expect(deps.fetchHtml).not.toHaveBeenCalled()
  })

  it('tool_summaries_are_bounded_and_exclude_raw_html', async () => {
    const longHtml = `<html><head><title>Big Page</title></head><body>${'a'.repeat(200_000)}</body></html>`
    const deps = makeDeps({
      fetchHtml: vi.fn().mockResolvedValue({ text: longHtml, status: 200, latencyMs: 50, error: null }),
    })
    const tools = createAcquisitionTools(deps, {
      knownUrls: new Set(['https://big.example.com']),
      discoveredUrls: new Set(),
    })
    const probeStatic = tools.find((t) => t.name === 'probe_static')!
    const result = await probeStatic.invoke({ url: 'https://big.example.com' })
    const json = JSON.stringify(result)
    expect(json.length).toBeLessThanOrEqual(1536) // 1.5 KB
    expect(json).not.toContain('<')
    expect(result).toHaveProperty('title')
    expect(result).toHaveProperty('textLength')
    expect(result).toHaveProperty('needsRendering')
  })

  it('extract_links_adds_returned_urls_to_allowlist', async () => {
    const html = '<html><body><a href="https://found.example.com/page">Link</a></body></html>'
    const deps = makeDeps({
      fetchHtml: vi.fn().mockResolvedValue({ text: html, status: 200, latencyMs: 50, error: null }),
    })
    const allowlist = {
      knownUrls: new Set(['https://example.com']),
      discoveredUrls: new Set<string>(),
    }
    const tools = createAcquisitionTools(deps, allowlist)
    const extractLinks = tools.find((t) => t.name === 'extract_links')!
    await extractLinks.invoke({ url: 'https://example.com' })
    // The discovered URL should now be probe-able
    expect(allowlist.discoveredUrls.has('https://found.example.com/page')).toBe(true)

    const probeStatic = tools.find((t) => t.name === 'probe_static')!
    const result = await probeStatic.invoke({ url: 'https://found.example.com/page' })
    expect(result).not.toHaveProperty('error')
  })

  it('search_brand_only_in_recovery_and_once', async () => {
    const deps = makeDeps()
    const tools = createAcquisitionTools(deps, {
      knownUrls: new Set(),
      discoveredUrls: new Set(),
    })
    const searchBrand = tools.find((t) => t.name === 'search_brand')!

    // Calling outside recovery phase throws
    await expect(searchBrand.invoke({ query: 'test brand', phase: 'plan' }))
      .resolves.toEqual({ error: 'search_only_in_recovery' })

    // First call in recover works
    const result = await searchBrand.invoke({ query: 'test brand', phase: 'recover' })
    expect(result).toHaveProperty('urls')

    // Second call throws
    const result2 = await searchBrand.invoke({ query: 'test brand again', phase: 'recover' })
    expect(result2).toEqual({ error: 'search_already_used' })
  })
})
