import { auditedCall } from '@/lib/audit'
import type { Browser } from '@playwright/test'
import type { RenderProvider, RenderResult } from './types'

export type PlaywrightProvider = RenderProvider & { close(): Promise<void> }

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

export function createPlaywrightProvider(
  deps?: { launch?: () => Promise<Browser> },
): PlaywrightProvider {
  let launching: Promise<Browser> | null = null

  async function defaultLaunch(): Promise<Browser> {
    const { chromium } = await import('@playwright/test')
    return chromium.launch({ headless: true })
  }

  const launch = deps?.launch ?? defaultLaunch

  function getBrowser(): Promise<Browser> {
    if (launching) {
      // Check if the resolved browser is still connected.
      return launching.then((browser) => {
        if (browser.isConnected()) return browser
        // Disconnected — relaunch.
        launching = launch().catch((e) => {
          launching = null
          throw e
        })
        return launching
      })
    }
    launching = launch().catch((e) => {
      launching = null
      throw e
    })
    return launching
  }

  return {
    async fetchRendered(url: string): Promise<RenderResult> {
      const browser = await getBrowser()
      return fetchPage(browser, url)
    },

    async fetchRenderedBatch(
      urls: readonly string[],
    ): Promise<Array<RenderResult | null>> {
      const browser = await getBrowser()
      return Promise.all(
        urls.map(async (url) => {
          try {
            return await fetchPage(browser, url)
          } catch {
            return null
          }
        }),
      )
    },

    async close(): Promise<void> {
      if (!launching) return
      const browserPromise = launching
      launching = null
      try {
        const browser = await browserPromise
        await browser.close()
      } catch {
        // Swallow close errors.
      }
    },
  }
}
