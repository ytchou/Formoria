import * as cheerio from "cheerio";
import { getRenderProvider } from "./render";
import type { RenderProvider } from "./render/types";

export function extractRenderedMainText(html: string): string {
  const $ = cheerio.load(html);
  const root = $("main").first().length > 0 ? $("main").first() : $("body").first();
  root.find("script, style, noscript, nav, header, footer, form").remove();
  root.find("br").replaceWith(" ");
  root.find("h1, h2, h3, h4, h5, h6, p, li, dt, dd, th, td").each((_, element) => {
    $(element).after(" ");
  });
  return root.text().replace(/\s+/gu, " ").trim();
}

/**
 * Loads complete rendered product-page text through the scraper adapter. The
 * local provider batches URLs in one browser; injected providers may fall back
 * to concurrent single-page calls.
 */
export async function loadRenderedProductTexts(
  urls: readonly string[],
  provider: RenderProvider = getRenderProvider(),
): Promise<Map<string, string>> {
  const uniqueUrls = [...new Set(urls.filter(Boolean))];
  if (uniqueUrls.length === 0) return new Map();

  const results = provider.fetchRenderedBatch
    ? await provider.fetchRenderedBatch(uniqueUrls)
    : await Promise.all(
        uniqueUrls.map(async (url) => {
          try {
            return await provider.fetchRendered(url);
          } catch {
            return null;
          }
        }),
      );

  const byUrl = new Map<string, string>();
  for (let index = 0; index < uniqueUrls.length; index += 1) {
    const result = results[index];
    if (!result) continue;
    const text = extractRenderedMainText(result.html);
    if (text) byUrl.set(uniqueUrls[index]!, text);
  }
  return byUrl;
}
