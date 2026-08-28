import * as cheerio from 'cheerio'
import type { RenderProvider } from './render/types'
import { fetchHtml } from './fetch-guards'

export function extractRenderedMainText(html: string): string {
  const $ = cheerio.load(html)
  const root =
    $('main').first().length > 0 ? $('main').first() : $('body').first()
  root.find('script, style, noscript, nav, header, footer, form').remove()
  root.find('br').replaceWith(' ')
  root
    .find('h1, h2, h3, h4, h5, h6, p, li, dt, dd, th, td')
    .each((_, element) => {
      $(element).after(' ')
    })
  return root.text().replace(/\s+/gu, ' ').trim()
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
