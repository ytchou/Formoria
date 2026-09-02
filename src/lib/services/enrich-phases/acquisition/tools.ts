/**
 * Acquisition agent tools. Each tool is a plain object with name, description,
 * schema, and invoke. Tools use injected dependencies and enforce the provenance
 * allowlist.
 */

import * as cheerio from 'cheerio'
import type { FetchMetadata } from '../scraper/fetch-guards'
import type { RenderProvider } from '../scraper/render/types'
import { needsRendering } from '../catalog-discovery'

const MAX_SUMMARY_BYTES = 1536 // 1.5 KB

export type SearchResult = {
  urls: string[]
  snippets: string[]
}

export type AcquisitionToolDeps = {
  fetchHtml: (url: string) => Promise<FetchMetadata>
  renderProvider?: RenderProvider
  searchBrand: (query: string) => Promise<SearchResult>
}

export type ProvenanceAllowlist = {
  knownUrls: Set<string>
  discoveredUrls: Set<string>
}

type ToolResult = Record<string, unknown>

export type AcquisitionTool = {
  name: string
  description: string
  invoke: (input: Record<string, unknown>) => Promise<ToolResult>
}

function isInAllowlist(url: string, allowlist: ProvenanceAllowlist): boolean {
  return allowlist.knownUrls.has(url) || allowlist.discoveredUrls.has(url)
}

/**
 * Extracts a bounded summary from HTML. Includes title, textLength,
 * scriptCount, needsRendering, platform hints, and discovered links.
 * Never includes raw HTML. Truncates to 1.5 KB.
 */
function summarizeHtml(html: string, url: string): ToolResult {
  const $ = cheerio.load(html)
  const title = $('title').first().text().trim().slice(0, 120) || null
  const bodyText = $('body').text().replace(/\s+/gu, ' ').trim()
  const scriptCount = $('script').length

  // Extract links (absolute URLs only, deduplicated)
  const links: string[] = []
  $('a[href]').each((_, el) => {
    try {
      const href = $(el).attr('href')
      if (!href) return
      const resolved = new URL(href, url).href
      if (resolved.startsWith('http') && !links.includes(resolved)) {
        links.push(resolved)
      }
    } catch {
      // invalid URL, skip
    }
  })

  // Detect platform from meta tags
  const ogSiteName = $('meta[property="og:site_name"]').attr('content')?.trim() || null
  const generator = $('meta[name="generator"]').attr('content')?.trim() || null

  const summary: ToolResult = {
    title,
    textLength: bodyText.length,
    scriptCount,
    needsRendering: needsRendering(html),
    platform: ogSiteName || generator,
    links: links.slice(0, 20),
  }

  // Ensure we stay under the byte limit
  let json = JSON.stringify(summary)
  if (json.length > MAX_SUMMARY_BYTES) {
    // Trim links first
    summary.links = (summary.links as string[]).slice(0, 5)
    json = JSON.stringify(summary)
  }
  if (json.length > MAX_SUMMARY_BYTES) {
    summary.links = []
    json = JSON.stringify(summary)
  }

  return summary
}

/**
 * Creates the four acquisition tools with injected dependencies and a shared
 * provenance allowlist. The allowlist grows as extract_links discovers new URLs.
 */
export function createAcquisitionTools(
  deps: AcquisitionToolDeps,
  allowlist: ProvenanceAllowlist,
): AcquisitionTool[] {
  let searchUsed = false

  const probeStatic: AcquisitionTool = {
    name: 'probe_static',
    description: 'Fetches a URL statically and returns a bounded summary (title, text length, scripts, links). URL must be in the provenance allowlist.',
    async invoke(input) {
      const url = input.url as string
      if (!isInAllowlist(url, allowlist)) {
        return { error: 'not_in_allowlist' }
      }
      try {
        const result = await deps.fetchHtml(url)
        if (result.error || !result.text) {
          return { error: result.error || 'empty_response', status: result.status }
        }
        return summarizeHtml(result.text, url)
      } catch (err) {
        return { error: err instanceof Error ? err.message : 'fetch_failed' }
      }
    },
  }

  const probeRendered: AcquisitionTool = {
    name: 'probe_rendered',
    description: 'Renders a URL with a headless browser and returns a bounded summary. URL must be in the provenance allowlist.',
    async invoke(input) {
      const url = input.url as string
      if (!isInAllowlist(url, allowlist)) {
        return { error: 'not_in_allowlist' }
      }
      if (!deps.renderProvider) {
        return { error: 'no_render_provider' }
      }
      try {
        const result = await deps.renderProvider.fetchRendered(url)
        return summarizeHtml(result.html, result.finalUrl)
      } catch (err) {
        return { error: err instanceof Error ? err.message : 'render_failed' }
      }
    },
  }

  const extractLinks: AcquisitionTool = {
    name: 'extract_links',
    description: 'Extracts navigation and content links from a previously-fetched URL. Adds discovered links to the provenance allowlist.',
    async invoke(input) {
      const url = input.url as string
      if (!isInAllowlist(url, allowlist)) {
        return { error: 'not_in_allowlist' }
      }
      try {
        const result = await deps.fetchHtml(url)
        if (!result.text) {
          return { error: 'empty_response', links: [] }
        }
        const $ = cheerio.load(result.text)
        const links: string[] = []
        $('a[href]').each((_, el) => {
          try {
            const href = $(el).attr('href')
            if (!href) return
            const resolved = new URL(href, url).href
            if (resolved.startsWith('http') && !links.includes(resolved)) {
              links.push(resolved)
              // Grow the allowlist
              allowlist.discoveredUrls.add(resolved)
            }
          } catch {
            // invalid URL
          }
        })
        return { links: links.slice(0, 30) }
      } catch (err) {
        return { error: err instanceof Error ? err.message : 'extract_failed', links: [] }
      }
    },
  }

  const searchBrand: AcquisitionTool = {
    name: 'search_brand',
    description: 'Searches for a brand by name. Only available in the recovery phase, and only once per run.',
    async invoke(input) {
      const phase = input.phase as string
      if (phase !== 'recover') {
        return { error: 'search_only_in_recovery' }
      }
      if (searchUsed) {
        return { error: 'search_already_used' }
      }
      searchUsed = true
      try {
        const query = input.query as string
        const result = await deps.searchBrand(query)
        // Add discovered URLs to allowlist
        for (const url of result.urls) {
          allowlist.discoveredUrls.add(url)
        }
        return { urls: result.urls, snippets: result.snippets }
      } catch (err) {
        return { error: err instanceof Error ? err.message : 'search_failed' }
      }
    },
  }

  return [probeStatic, probeRendered, extractLinks, searchBrand]
}
