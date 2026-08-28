import { auditedCall } from '@/lib/audit'
import type { Browser } from '@playwright/test'
import type { RenderProvider, RenderResult } from './types'

async function fetchPage(
  browser: Browser,
  url: string,
): Promise<RenderResult> {
  return auditedCall(
    { provider: 'playwright', operation: 'fetch_rendered', kind: 'external' },
    async (ctx) => {
      const page = await browser.newPage()
      try {
        const response = await page.goto(url, { waitUntil: 'networkidle' })
        const html = await page.content()
        const finalUrl = page.url()
        const status = response?.status() ?? 200
        ctx.summary.finalUrl = finalUrl
        ctx.summary.htmlLength = html.length
        ctx.summary.status = status
        return { html, finalUrl, status }
      } finally {
        await page.close()
      }
    },
    { summary: { url } },
  )
}

export function createLocalPlaywrightProvider(): RenderProvider {
  return {
    async fetchRendered(url: string) {
      const { chromium } = await import('@playwright/test')
      const browser = await chromium.launch({ headless: true })
      try {
        return await fetchPage(browser, url)
      } finally {
        await browser.close()
      }
    },
    async fetchRenderedBatch(urls: readonly string[]) {
      const { chromium } = await import('@playwright/test')
      const browser = await chromium.launch({ headless: true })
      try {
        return await Promise.all(
          urls.map(async (url) => {
            try {
              return await fetchPage(browser, url)
            } catch {
              return null
            }
          }),
        )
      } finally {
        await browser.close()
      }
    },
  }
}
