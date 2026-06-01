import type { RenderProvider } from './types'

export function createLocalPlaywrightProvider(): RenderProvider {
  return {
    async fetchRendered(url: string) {
      const { chromium } = await import('@playwright/test')
      const browser = await chromium.launch({ headless: true })

      try {
        const page = await browser.newPage()
        await page.goto(url, { waitUntil: 'networkidle' })
        const html = await page.content()

        return {
          html,
          finalUrl: page.url(),
          status: 200,
        }
      } finally {
        await browser.close()
      }
    },
  }
}
