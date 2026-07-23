import { isPrivateUrl } from '@/lib/url'

export { isPrivateUrl } from '@/lib/url'

const FETCH_TIMEOUT_MS = 10_000
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024
const SCRAPER_USER_AGENT = 'Formoria-Bot/1.0'

export type FetchMetadata = {
  text: string | null
  status: number | null
  latencyMs: number
  error: string | null
}

export function resolveUrl(rawUrl: string, pageUrl: string): string | null {
  if (!rawUrl || rawUrl.startsWith('data:')) return null
  try {
    const resolved = new URL(rawUrl, pageUrl).href
    return isPrivateUrl(resolved) ? null : resolved
  } catch {
    return null
  }
}

async function fetchText(
  url: string,
  accept: string,
  isAllowedContentType: (contentType: string) => boolean
): Promise<string | null> {
  return (await fetchTextWithMetadata(url, accept, isAllowedContentType)).text
}

async function fetchTextWithMetadata(
  url: string,
  accept: string,
  isAllowedContentType: (contentType: string) => boolean,
): Promise<FetchMetadata> {
  const startedAt = Date.now()
  try {
    if (isPrivateUrl(url)) {
      return { text: null, status: null, latencyMs: Date.now() - startedAt, error: 'private URL' }
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': SCRAPER_USER_AGENT,
          Accept: accept,
        },
      })

      if (!response.ok) {
        return { text: null, status: response.status, latencyMs: Date.now() - startedAt, error: `HTTP ${response.status}` }
      }

      // Verify content-type before reading body
      const contentType = response.headers.get('content-type') ?? ''
      if (!isAllowedContentType(contentType)) {
        return { text: null, status: response.status, latencyMs: Date.now() - startedAt, error: 'unexpected content type' }
      }

      // Check content-length before reading body
      const contentLength = parseInt(
        response.headers.get('content-length') ?? '0',
        10
      )
      if (contentLength > MAX_RESPONSE_BYTES) {
        return { text: null, status: response.status, latencyMs: Date.now() - startedAt, error: 'response too large' }
      }

      const text = await response.text()
      if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
        return { text: null, status: response.status, latencyMs: Date.now() - startedAt, error: 'response too large' }
      }

      return { text, status: response.status, latencyMs: Date.now() - startedAt, error: null }
    } finally {
      clearTimeout(timeoutId)
    }
  } catch (error) {
    return {
      text: null,
      status: null,
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
    }
  }
}

export async function fetchHtml(url: string): Promise<string | null> {
  return fetchText(url, 'text/html', (contentType) =>
    contentType.includes('text/html')
  )
}

export async function fetchHtmlWithMetadata(url: string): Promise<FetchMetadata> {
  return fetchTextWithMetadata(url, 'text/html', (contentType) =>
    contentType.includes('text/html')
  )
}

export async function fetchXml(url: string): Promise<string | null> {
  return fetchText(url, 'application/xml, text/xml', (contentType) =>
    contentType.includes('application/xml') || contentType.includes('text/xml')
  )
}
