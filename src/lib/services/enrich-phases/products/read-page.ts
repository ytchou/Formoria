/**
 * Structured evidence for one product page.
 *
 * The products agent used to store `deps.fetchHtml(url).text` and hand the raw
 * markup to the model (DEV-1644 F24): no JSON-LD, no og tags, no origin
 * excerpts, and a render path that could never fire because the budget was
 * sized from a `.filter(() => false)`. A page behind a JS shell therefore
 * reached the model as an empty `<div id="root">`, and the origin check had no
 * text to read.
 *
 * This module is the read half of that fix. It is pure I/O composition over
 * helpers that already exist — `needsRendering`, `extractMainTextBlocks`,
 * `extractAllJsonLd`, `extractJsonLdImages`, `hasProductSignals`,
 * `buildOriginExcerpts` — so the evidence the agent proposes from is the same
 * evidence the single-call body and the catalog discovery use.
 *
 * `mainText` is no longer a positional prefix (DEV-1855). The page's text
 * blocks go through `selectPageText`, which keeps the lead and fact-bearing
 * blocks within `MAX_MAIN_TEXT_CHARS` and drops chrome. The full `blocks` ride
 * along so a consumer can run `selectAcrossPages` over a brand's pages to drop
 * cross-page repeats; that call strips `blocks` before the evidence leaves the
 * consumer. Origin excerpts read the full text, never the selected text.
 *
 * Every external call arrives through `deps`: `fetchHtml` is the caller's
 * guarded fetch and `renderProvider` the caller's budgeted renderer. Nothing
 * here calls `fetch` directly (`scripts/check-audited-external-calls.mjs`).
 */

import * as cheerio from 'cheerio'

import { needsRendering, hasProductSignals } from '../catalog-discovery'
import { extractMainTextBlocks } from '../scraper/product-origin-text'
import { extractAllJsonLd, extractJsonLdImages } from '../scraper/parse/extractors'
import { resolveUrl } from '../scraper/fetch-guards'
import type { RenderProvider } from '../scraper/render/types'
import {
  buildOriginExcerpts,
  type OriginExcerpt,
} from '@/lib/services/curated-products/origin-qualification'
import { allowRenderFor, type ProductsBudgetState } from './budget'
import { selectPageText, type TextStats } from './select-evidence'

/**
 * Main text ceiling per page, owned by `select-evidence` and re-exported here
 * for existing importers.
 */
export { MAX_MAIN_TEXT_CHARS } from './select-evidence'

export type ProductPageEvidence = {
  url: string
  /** og:title, falling back to `<title>`. */
  title: string | null
  /** og:description, falling back to `<meta name="description">`. */
  description: string | null
  /** Selected main-content text, at most `MAX_MAIN_TEXT_CHARS` (`selectPageText`). */
  mainText: string
  /**
   * Full unselected blocks; stripped by `selectAcrossPages` before leaving a
   * consumer. Absent on recorded evidence and fixtures.
   */
  blocks?: string[]
  /** How `mainText` was selected from `blocks`. */
  textStats?: TextStats
  /** Absolute image URLs from JSON-LD and og:image, in that order. */
  images: string[]
  /** The first JSON-LD block, for the propose prompt's structured evidence. */
  jsonLd: Record<string, unknown> | null
  /** `true` when the page announces itself as a product page. */
  productSignals: boolean
  /** Origin-adjacent windows with stable ids, the input to `verifyOrigin`. */
  originExcerpts: OriginExcerpt[]
  /** `true` when the body came from the render provider, not the static fetch. */
  rendered: boolean
  statusCode: number
}

export type ReadPageDeps = {
  /** The caller's guarded fetch. Never `globalThis.fetch`. */
  fetchHtml: (url: string) => Promise<{ text: string; statusCode: number }>
  /** Absent on the local path; a render is simply skipped then. */
  renderProvider?: Pick<RenderProvider, 'fetchRendered'>
  /** Shared with the graph, so a render spent here is a render the graph sees. */
  budget: ProductsBudgetState
  /** Rendered origin text loader, when the phase supplied one. */
  loadOriginTexts?: (urls: readonly string[]) => Promise<Map<string, string>>
  /** Seeds the excerpt ids so they match the persisted candidate row. */
  candidateId?: string
}

function metaContent($: cheerio.CheerioAPI, selectors: string[]): string | null {
  for (const selector of selectors) {
    const value = $(selector).attr('content')?.trim()
    if (value) return value
  }
  return null
}

/** JSON-LD images first (they are the product's own), then og:image. */
function collectImages($: cheerio.CheerioAPI, pageUrl: string): string[] {
  const jsonLdObjects = extractAllJsonLd($)
  const images = new Set(extractJsonLdImages(jsonLdObjects, pageUrl))

  const ogImage = metaContent($, [
    'meta[property="og:image"]',
    'meta[name="og:image"]',
    'meta[property="og:image:secure_url"]',
  ])
  if (ogImage) {
    const resolved = resolveUrl(ogImage, pageUrl)
    if (resolved) images.add(resolved)
  }

  return [...images]
}

/**
 * Fetches one product page, rendering it when the static body is a shell and a
 * render is still affordable, and returns the structured evidence the propose
 * and verify steps read. Never throws: a dead page returns empty evidence with
 * its status code, because one unreachable candidate must not end the phase.
 */
export async function readProductPage(
  url: string,
  deps: ReadPageDeps,
): Promise<ProductPageEvidence> {
  let html = ''
  let statusCode = 0
  try {
    const response = await deps.fetchHtml(url)
    html = response.text ?? ''
    statusCode = response.statusCode
  } catch {
    // A refused or timed-out fetch is evidence of nothing, not a phase failure.
  }

  let rendered = false
  if (needsRendering(html) && deps.renderProvider && allowRenderFor(deps.budget)) {
    // Charged BEFORE the call, not after: a render that throws still consumed
    // the provider slot, and a failure that costs nothing is a retry loop.
    deps.budget.used.renders += 1
    try {
      const result = await deps.renderProvider.fetchRendered(url)
      if (result?.html) {
        html = result.html
        statusCode = result.status
        rendered = true
      }
    } catch {
      // Keep the static body. Rendering is evidence collection, not publication.
    }
  }

  if (!html.trim()) {
    return {
      url,
      title: null,
      description: null,
      mainText: '',
      blocks: [],
      textStats: selectPageText([]).textStats,
      images: [],
      jsonLd: null,
      productSignals: false,
      originExcerpts: [],
      rendered,
      statusCode,
    }
  }

  const $ = cheerio.load(html)
  const title =
    metaContent($, ['meta[property="og:title"]', 'meta[name="og:title"]']) ??
    ($('title').first().text().trim() || null)
  const description = metaContent($, [
    'meta[property="og:description"]',
    'meta[name="og:description"]',
    'meta[name="description"]',
  ])
  const blocks = extractMainTextBlocks(html)
  const { mainText, textStats } = selectPageText(blocks)

  // The loader is preferred because it may render a page this read did not, but
  // the page just read is the fallback — an origin check with no text at all is
  // how `verifyOrigin` ended up never being called (F6). The fallback is the
  // FULL text, not the selected `mainText`: an origin sentence past the budget
  // must still reach the origin check (D9).
  const fullText = blocks.join(' ')
  let originText = fullText
  if (deps.loadOriginTexts) {
    try {
      const loaded = await deps.loadOriginTexts([url])
      originText = loaded.get(url) ?? fullText
    } catch {
      // Loader failure removes the better text, never the page's own.
    }
  }

  return {
    url,
    title,
    description,
    mainText,
    blocks,
    textStats,
    images: collectImages($, url),
    jsonLd: extractAllJsonLd($)[0] ?? null,
    productSignals: hasProductSignals(html),
    originExcerpts: buildOriginExcerpts(deps.candidateId ?? url, originText),
    rendered,
    statusCode,
  }
}
