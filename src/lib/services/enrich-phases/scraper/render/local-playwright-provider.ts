import { auditedCall } from '@/lib/audit'
import type { RenderProvider } from './types'

export function createLocalPlaywrightProvider(): RenderProvider {
  return {
    async fetchRendered(url: string) {
      const summary: Record<string, unknown> = { url }
      return auditedCall(
        { provider: 'playwright', operation: 'fetch_rendered', kind: 'external' },
        async () => {
          const { chromium } = await import('@playwright/test')
          const browser = await chromium.launch({ headless: true })

          try {
            const page = await browser.newPage()
            await page.goto(url, { waitUntil: 'networkidle' })
            const html = await page.content()
            const finalUrl = page.url()
            summary.finalUrl = finalUrl
            summary.htmlLength = html.length

            return {
              html,
              finalUrl,
              status: 200,
            }
          } finally {
            await browser.close()
          }
        },
        { summary },
      )
    },
  }
}
