/**
 * Day-1 render spike: probe IG / Threads / Portaly profile URLs through
 * the local Playwright provider (and optionally Browserless) to measure
 * what each platform returns for bio text and outbound links.
 *
 * Usage:
 *   pnpm exec tsx scripts/dev-1644/social-render-spike.ts --target staging
 */

import * as cheerio from 'cheerio'
import { writeFileSync } from 'node:fs'
import { isPrivateUrl } from '@/lib/url'
import { loadScriptTarget } from '../shared/target'
import { extractRenderedMainText } from '@/lib/services/enrich-phases/scraper/product-origin-text'
import { createLocalPlaywrightProvider } from '@/lib/services/enrich-phases/scraper/render/local-playwright-provider'
import { createBrowserlessProvider } from '@/lib/services/enrich-phases/scraper/render/browserless-provider'
import type { RenderProvider } from '@/lib/services/enrich-phases/scraper/render/types'

// ---------------------------------------------------------------------------
// Hard-coded test URLs
// ---------------------------------------------------------------------------

interface TargetUrl {
  platform: 'instagram' | 'threads' | 'portaly'
  url: string
}

const TARGETS: TargetUrl[] = [
  // Instagram
  { platform: 'instagram', url: 'https://www.instagram.com/greenroom_tw/' },
  { platform: 'instagram', url: 'https://www.instagram.com/oka.furniturelab/' },
  { platform: 'instagram', url: 'https://www.instagram.com/meimeitw_official/' },
  { platform: 'instagram', url: 'https://www.instagram.com/4mano.caffe/' },
  { platform: 'instagram', url: 'https://www.instagram.com/kamaro_an/' },
  // Threads
  { platform: 'threads', url: 'https://www.threads.net/@greenroom_tw' },
  { platform: 'threads', url: 'https://www.threads.net/@oka.furniturelab' },
  { platform: 'threads', url: 'https://www.threads.net/@meimeitw_official' },
  { platform: 'threads', url: 'https://www.threads.net/@4mano.caffe' },
  { platform: 'threads', url: 'https://www.threads.net/@kamaro_an' },
  // Portaly
  { platform: 'portaly', url: 'https://portaly.cc/greenroom' },
  { platform: 'portaly', url: 'https://portaly.cc/okafurniturelab' },
  { platform: 'portaly', url: 'https://portaly.cc/4manocaffe' },
]

// ---------------------------------------------------------------------------
// Detection helpers
// ---------------------------------------------------------------------------

function detectBio(html: string): boolean {
  const $ = cheerio.load(html)

  // og:description with >= 20 chars
  const ogDesc = $('meta[property="og:description"]').attr('content') ?? ''
  if (ogDesc.length >= 20) return true

  // meta name="description" with >= 20 chars
  const metaDesc = $('meta[name="description"]').attr('content') ?? ''
  if (metaDesc.length >= 20) return true

  // body text >= 200 chars after extractRenderedMainText
  const bodyText = extractRenderedMainText(html)
  if (bodyText.length >= 200) return true

  return false
}

function countOutboundLinks(html: string): number {
  const $ = cheerio.load(html)
  let count = 0
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href')
    if (!href) return
    try {
      const parsed = new URL(href, 'https://portaly.cc')
      const host = parsed.hostname.toLowerCase()
      if (!host.endsWith('portaly.cc') && parsed.protocol.startsWith('http')) {
        count += 1
      }
    } catch {
      // skip malformed hrefs
    }
  })
  return count
}

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

interface ProbeResult {
  platform: string
  url: string
  provider: string
  status: number | 'error'
  htmlLength: number
  bioFound: boolean
  linksFound: number | '-'
  error?: string
}

// ---------------------------------------------------------------------------
// Probe a single URL
// ---------------------------------------------------------------------------

async function probe(
  target: TargetUrl,
  provider: RenderProvider,
  providerName: string,
): Promise<ProbeResult> {
  try {
    const result = await provider.fetchRendered(target.url)
    const bioFound = detectBio(result.html)
    const linksFound =
      target.platform === 'portaly' ? countOutboundLinks(result.html) : ('-' as const)
    return {
      platform: target.platform,
      url: target.url,
      provider: providerName,
      status: result.status,
      htmlLength: result.html.length,
      bioFound,
      linksFound,
    }
  } catch (err) {
    return {
      platform: target.platform,
      url: target.url,
      provider: providerName,
      status: 'error',
      htmlLength: 0,
      bioFound: false,
      linksFound: target.platform === 'portaly' ? 0 : '-',
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

// ---------------------------------------------------------------------------
// Output formatting
// ---------------------------------------------------------------------------

function padRight(s: string, len: number): string {
  return s.length >= len ? s : s + ' '.repeat(len - s.length)
}

function printTable(results: ProbeResult[]): void {
  const cols = [
    { key: 'platform' as const, label: 'Platform', width: 11 },
    { key: 'url' as const, label: 'URL', width: 52 },
    { key: 'provider' as const, label: 'Provider', width: 14 },
    { key: 'status' as const, label: 'Status', width: 8 },
    { key: 'htmlLength' as const, label: 'HTML Len', width: 10 },
    { key: 'bioFound' as const, label: 'Bio?', width: 6 },
    { key: 'linksFound' as const, label: 'Links', width: 7 },
  ]

  const header = cols.map((c) => padRight(c.label, c.width)).join(' | ')
  const separator = cols.map((c) => '-'.repeat(c.width)).join('-+-')

  console.log(header)
  console.log(separator)

  for (const r of results) {
    const row = cols
      .map((c) => {
        const val = String(r[c.key])
        return padRight(val, c.width)
      })
      .join(' | ')
    console.log(row)
    if (r.error) {
      console.log(`  ERROR: ${r.error}`)
    }
  }
}

function toMarkdownTable(results: ProbeResult[]): string {
  const headers = ['Platform', 'URL', 'Provider', 'Status', 'HTML Len', 'Bio?', 'Links']
  const rows = results.map((r) => [
    r.platform,
    r.url,
    r.provider,
    String(r.status),
    String(r.htmlLength),
    String(r.bioFound),
    String(r.linksFound),
  ])

  const headerLine = `| ${headers.join(' | ')} |`
  const separatorLine = `| ${headers.map(() => '---').join(' | ')} |`
  const dataLines = rows.map((row) => `| ${row.join(' | ')} |`)

  return [headerLine, separatorLine, ...dataLines].join('\n')
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  loadScriptTarget()

  // Security check: reject any private URLs
  for (const target of TARGETS) {
    if (isPrivateUrl(target.url)) {
      throw new Error(`Refusing to render private URL: ${target.url}`)
    }
  }

  const results: ProbeResult[] = []

  // Always run local Playwright
  console.log('\n=== Local Playwright ===\n')
  const localProvider = createLocalPlaywrightProvider()

  for (const target of TARGETS) {
    console.log(`  Probing ${target.url} ...`)
    const result = await probe(target, localProvider, 'local-pw')
    results.push(result)
  }

  // Optionally run Browserless
  const renderApiKey = process.env.RENDER_API_KEY?.trim()
  if (renderApiKey) {
    console.log('\n=== Browserless ===\n')
    const browserlessProvider = createBrowserlessProvider({ apiKey: renderApiKey })

    for (const target of TARGETS) {
      console.log(`  Probing ${target.url} ...`)
      const result = await probe(target, browserlessProvider, 'browserless')
      results.push(result)
    }
  } else {
    console.log('\nSkipping Browserless (RENDER_API_KEY not set)\n')
  }

  // Print table
  console.log('\n=== Results ===\n')
  printTable(results)

  // Write markdown output
  const date = new Date().toISOString().slice(0, 10)
  const md = `# Social Render Spike — ${date}

## Scope

Probe Instagram, Threads, and Portaly profile URLs through local Playwright
(and Browserless when \`RENDER_API_KEY\` is set) to determine what each platform
returns for bio text and outbound links.

## Results

${toMarkdownTable(results)}

## Scope Decision

<!-- Fill in after reviewing results -->

- [ ] Instagram profiles: renderable? worth scraping?
- [ ] Threads profiles: renderable? worth scraping?
- [ ] Portaly pages: renderable? bio + links extractable?
- [ ] Which provider to use in production?
- [ ] Rate-limit / cost considerations?
`

  const outputPath = 'docs/dev-1644/spike-social-render.md'
  writeFileSync(outputPath, md, 'utf-8')
  console.log(`\nWrote ${outputPath}`)
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
