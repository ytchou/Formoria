import { MAX_RESPONSE_BYTES } from '../fetch-guards'
import type { RenderProvider } from './types'

const HOSTED_RENDER_TIMEOUT_MS = 15_000

// Browserless production endpoint used by default for hosted rendering.
export const DEFAULT_BROWSERLESS_BASE_URL = 'https://production-sfo.browserless.io'

async function readCappedText(response: Response): Promise<string> {
  const contentLength = Number.parseInt(
    response.headers.get('content-length') ?? '0',
    10
  )
  if (contentLength > MAX_RESPONSE_BYTES) {
    throw new Error('Hosted render response exceeded maximum size')
  }

  if (!response.body) {
    const text = await response.text()
    if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
      throw new Error('Hosted render response exceeded maximum size')
    }
    return text
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue

    totalBytes += value.byteLength
    if (totalBytes > MAX_RESPONSE_BYTES) {
      await reader.cancel()
      throw new Error('Hosted render response exceeded maximum size')
    }

    chunks.push(value)
  }

  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  return new TextDecoder().decode(bytes)
}

export function createHostedRenderProvider(
  apiKey: string,
  opts?: { baseUrl?: string }
): RenderProvider {
  const baseUrl = opts?.baseUrl ?? DEFAULT_BROWSERLESS_BASE_URL

  return {
    async fetchRendered(url: string) {
      const endpoint = new URL('/content', baseUrl)
      endpoint.searchParams.set('token', apiKey)

      const controller = new AbortController()
      const timeoutId = setTimeout(
        () => controller.abort(),
        HOSTED_RENDER_TIMEOUT_MS
      )

      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            url,
            gotoOptions: {
              waitUntil: 'networkidle2',
              timeout: HOSTED_RENDER_TIMEOUT_MS,
            },
          }),
          signal: controller.signal,
        })
        const html = await readCappedText(response)

        return {
          html,
          finalUrl: url,
          status: response.status,
        }
      } finally {
        clearTimeout(timeoutId)
      }
    },
  }
}
