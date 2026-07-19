import { isPrivateUrl } from '@/lib/url'

export { isPrivateUrl } from '@/lib/url'

const FETCH_TIMEOUT_MS = 10_000
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024
const SCRAPER_USER_AGENT = 'Formoria-Bot/1.0'

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
  try {
    if (isPrivateUrl(url)) {
      return null
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
        return null
      }

      // Verify content-type before reading body
      const contentType = response.headers.get('content-type') ?? ''
      if (!isAllowedContentType(contentType)) {
        return null
      }

      // Check content-length before reading body
      const contentLength = parseInt(
        response.headers.get('content-length') ?? '0',
        10
      )
      if (contentLength > MAX_RESPONSE_BYTES) {
        return null
      }

      const text = await response.text()
      if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
        return null
      }

      return text
    } finally {
      clearTimeout(timeoutId)
    }
  } catch {
    return null
  }
}

export async function fetchHtml(url: string): Promise<string | null> {
  return fetchText(url, 'text/html', (contentType) =>
    contentType.includes('text/html')
  )
}

export async function fetchXml(url: string): Promise<string | null> {
  return fetchText(url, 'application/xml, text/xml', (contentType) =>
    contentType.includes('application/xml') || contentType.includes('text/xml')
  )
}
