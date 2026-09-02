import { auditedCall } from '@/lib/audit'
import { isPrivateUrl } from '@/lib/url'
import type { RenderProvider, RenderResult } from './types'

const BROWSERLESS_CONTENT_URL = 'https://production-sfo.browserless.io/content'
const TIMEOUT_MS = 30_000

export function createBrowserlessProvider(opts: {
  apiKey: string
}): RenderProvider {
  return {
    async fetchRendered(url: string): Promise<RenderResult> {
      if (isPrivateUrl(url)) {
        throw new Error(`Refusing to render private URL: ${url}`)
      }

      return auditedCall(
        { provider: 'browserless', operation: 'fetch_rendered', kind: 'external' },
        async (ctx) => {
          const response = await fetch(
            `${BROWSERLESS_CONTENT_URL}?token=${opts.apiKey}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                url,
                gotoOptions: { waitUntil: 'networkidle2' },
                rejectResourceTypes: ['image', 'media', 'font'],
                bestAttempt: true,
              }),
              signal: AbortSignal.timeout(TIMEOUT_MS),
            },
          )

          if (!response.ok) {
            const body = await response.text().catch(() => '')
            throw new Error(
              `Browserless returned ${response.status} ${response.statusText}: ${body}`,
            )
          }

          const html = await response.text()
          ctx.summary.finalUrl = url
          ctx.summary.htmlLength = html.length
          ctx.summary.status = 200
          return { html, finalUrl: url, status: 200 }
        },
        { summary: { url } },
      )
    },
  }
}
