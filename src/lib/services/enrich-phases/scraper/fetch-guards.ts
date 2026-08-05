import { auditedCall, type AuditStatus } from '@/lib/audit'
import { isPrivateUrl } from '@/lib/url'

export { isPrivateUrl } from '@/lib/url'

const FETCH_TIMEOUT_MS = 10_000
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024
const SCRAPER_USER_AGENT = 'Formoria-Bot/1.0'

type FetchOperation = 'fetch_html' | 'fetch_html_with_metadata' | 'fetch_xml'
type FetchReason =
  | 'none'
  | 'private_url'
  | 'response_too_large'
  | 'unexpected_content_type'
  | 'http_error'
  | 'timeout'
  | 'network_error'

export type FetchMetadata = {
  text: string | null
  status: number | null
  latencyMs: number
  error: string | null
}

type FetchOutcome = FetchMetadata & { reason: FetchReason }

function classifyFetchReason(reason: FetchReason): AuditStatus {
  switch (reason) {
    case 'none':
      return 'succeeded'
    case 'response_too_large':
      return 'empty'
    case 'unexpected_content_type':
      return 'malformed'
    case 'timeout':
      return 'timeout'
    case 'network_error':
      return 'network_error'
    case 'private_url':
    case 'http_error':
      return 'failed'
  }
}

function withoutFetchReason(outcome: FetchOutcome): FetchMetadata {
  return {
    text: outcome.text,
    status: outcome.status,
    latencyMs: outcome.latencyMs,
    error: outcome.error,
  }
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
  isAllowedContentType: (contentType: string) => boolean,
  operation: FetchOperation,
): Promise<string | null> {
  return (await fetchTextWithMetadata(url, accept, isAllowedContentType, operation)).text
}

async function fetchTextWithMetadata(
  url: string,
  accept: string,
  isAllowedContentType: (contentType: string) => boolean,
  operation: FetchOperation,
): Promise<FetchMetadata> {
  const result = await auditedCall(
    { provider: 'http', operation, kind: 'external' },
    async (ctx): Promise<FetchOutcome> => {
      const startedAt = Date.now()
      let timedOut = false

      // These fields are assigned late deliberately: only ctx.summary carries
      // values learned while fn runs into the terminal row.
      ctx.summary.contentType = null
      ctx.summary.byteLength = null
      ctx.summary.truncated = false

      try {
        if (isPrivateUrl(url)) {
          return {
            text: null,
            status: null,
            latencyMs: Date.now() - startedAt,
            error: 'private URL',
            reason: 'private_url',
          }
        }

        const controller = new AbortController()
        const timeoutId = setTimeout(() => {
          timedOut = true
          controller.abort()
        }, FETCH_TIMEOUT_MS)

        try {
          const response = await fetch(url, {
            signal: controller.signal,
            headers: {
              'User-Agent': SCRAPER_USER_AGENT,
              Accept: accept,
            },
          })
          if (!response.ok) {
            return {
              text: null,
              status: response.status,
              latencyMs: Date.now() - startedAt,
              error: `HTTP ${response.status}`,
              reason: 'http_error',
            }
          }

          // Verify content-type before reading body
          const contentType = response.headers.get('content-type') ?? ''
          ctx.summary.contentType = contentType
          if (!isAllowedContentType(contentType)) {
            return {
              text: null,
              status: response.status,
              latencyMs: Date.now() - startedAt,
              error: 'unexpected content type',
              reason: 'unexpected_content_type',
            }
          }

          // Check content-length before reading body
          const contentLength = parseInt(
            response.headers.get('content-length') ?? '0',
            10
          )
          if (contentLength > MAX_RESPONSE_BYTES) {
            ctx.summary.byteLength = contentLength
            ctx.summary.truncated = true
            return {
              text: null,
              status: response.status,
              latencyMs: Date.now() - startedAt,
              error: 'response too large',
              reason: 'response_too_large',
            }
          }

          const text = await response.text()
          const byteLength = new TextEncoder().encode(text).byteLength
          ctx.summary.byteLength = byteLength
          if (byteLength > MAX_RESPONSE_BYTES) {
            ctx.summary.truncated = true
            return {
              text: null,
              status: response.status,
              latencyMs: Date.now() - startedAt,
              error: 'response too large',
              reason: 'response_too_large',
            }
          }

          return {
            text,
            status: response.status,
            latencyMs: Date.now() - startedAt,
            error: null,
            reason: 'none',
          }
        } finally {
          clearTimeout(timeoutId)
        }
      } catch (error) {
        return {
          text: null,
          status: null,
          latencyMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
          reason:
            timedOut ||
            (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError'))
              ? 'timeout'
              : 'network_error',
        }
      }
    },
    {
      classify: (outcome) => classifyFetchReason(outcome.reason),
      summary: { url },
    },
  )

  return withoutFetchReason(result)
}

export async function fetchHtml(url: string): Promise<string | null> {
  return fetchText(url, 'text/html', (contentType) =>
    contentType.includes('text/html'),
    'fetch_html',
  )
}

export async function fetchHtmlWithMetadata(url: string): Promise<FetchMetadata> {
  return fetchTextWithMetadata(url, 'text/html', (contentType) =>
    contentType.includes('text/html'),
    'fetch_html_with_metadata',
  )
}

export async function fetchXml(url: string): Promise<string | null> {
  return fetchText(url, 'application/xml, text/xml', (contentType) =>
    contentType.includes('application/xml') || contentType.includes('text/xml'),
    'fetch_xml',
  )
}
