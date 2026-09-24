import * as cheerio from 'cheerio'
import type { RenderProvider } from './render/types'
import { fetchHtml } from './fetch-guards'

function mainRoot($: cheerio.CheerioAPI) {
  const root =
    $('main').first().length > 0 ? $('main').first() : $('body').first()
  root.find('script, style, noscript, nav, header, footer, form').remove()
  return root
}

export function extractRenderedMainText(html: string): string {
  const $ = cheerio.load(html)
  const root = mainRoot($)
  root.find('br').replaceWith(' ')
  root
    .find('h1, h2, h3, h4, h5, h6, p, li, dt, dd, th, td')
    .each((_, element) => {
      $(element).after(' ')
    })
  return root.text().replace(/\s+/gu, ' ').trim()
}

/**
 * Inserted between blocks. Private-use, and scrubbed from source text nodes
 * first (icon fonts emit private-use glyphs), so it only marks our boundaries.
 */
const BLOCK_BOUNDARY = '\uE000'

/**
 * Splits the same main-content root as extractRenderedMainText into text
 * blocks: one per block element or br-separated line, whitespace collapsed,
 * empties dropped. Loads its own document, so mutations never leak.
 *
 * Boundaries go before and after block elements, so loose text ahead of a
 * nested block stays separate. A label stays with its value: dt, th and td
 * are followed by a space, and the boundary after dd or around tr closes the
 * pair or row. Source whitespace, newlines included, never splits a block.
 */
export function extractMainTextBlocks(html: string): string[] {
  const $ = cheerio.load(html)
  const root = mainRoot($)
  root
    .find('*')
    .addBack()
    .contents()
    .each((_, node) => {
      if ('data' in node) {
        node.data = node.data.replaceAll(BLOCK_BOUNDARY, ' ')
      }
    })
  root.find('br').replaceWith(BLOCK_BOUNDARY)
  root.find('h1, h2, h3, h4, h5, h6, p, li, tr, div').each((_, element) => {
    $(element).before(BLOCK_BOUNDARY).after(BLOCK_BOUNDARY)
  })
  root.find('dt').each((_, element) => {
    $(element).before(BLOCK_BOUNDARY).after(' ')
  })
  root.find('dd').each((_, element) => {
    $(element).after(BLOCK_BOUNDARY)
  })
  root.find('th, td').each((_, element) => {
    $(element).after(' ')
  })
  return root
    .text()
    .split(BLOCK_BOUNDARY)
    .map((piece) => piece.replace(/\s+/gu, ' ').trim())
    .filter((piece) => piece.length > 0)
}

/**
 * Loads product-page text statically first. An optional local provider only
 * retries pages whose static response has no usable main text.
 */
export async function loadRenderedProductTexts(
  urls: readonly string[],
  provider?: RenderProvider,
): Promise<Map<string, string>> {
  const uniqueUrls = [...new Set(urls.filter(Boolean))]
  if (uniqueUrls.length === 0) return new Map()

  const byUrl = new Map<string, string>()
  const staticHtml = await Promise.all(uniqueUrls.map((url) => fetchHtml(url)))
  const renderUrls: string[] = []
  for (let index = 0; index < uniqueUrls.length; index += 1) {
    const text = extractRenderedMainText(staticHtml[index] ?? '')
    if (text) byUrl.set(uniqueUrls[index]!, text)
    else if (provider) renderUrls.push(uniqueUrls[index]!)
  }

  if (renderUrls.length > 0 && provider) {
    const rendered = provider.fetchRenderedBatch
      ? await provider.fetchRenderedBatch(renderUrls)
      : await Promise.all(
          renderUrls.map(async (url) => {
            try {
              return await provider.fetchRendered(url)
            } catch {
              return null
            }
          }),
        )
    for (let index = 0; index < renderUrls.length; index += 1) {
      const result = rendered[index]
      if (!result) continue
      const text = extractRenderedMainText(result.html)
      if (text) byUrl.set(renderUrls[index]!, text)
    }
  }
  return byUrl
}
