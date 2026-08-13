import { describe, it, expect } from 'vitest'
import { extractPostgrestContext, summarizeUpstreamHtmlError } from '../sentry.server.config'

const cloudflare522 = (rayId: string, timestamp: string) => `<!DOCTYPE html>
<html class="no-js" lang="en-US">
<head>
<title>supabase.co | 522: Connection timed out</title>
</head>
<body>
<div class="mt-3">${timestamp}</div>
<span>Cloudflare Ray ID: <strong>${rayId}</strong></span>
</body>
</html>`

describe('extractPostgrestContext', () => {
  it('extracts PostgREST fields from error.cause', () => {
    const pgError = { code: 'PGRST301', message: 'JWT expired', details: 'token exp claim is in the past', hint: null }
    const error = new Error('Service failed')
    error.cause = pgError
    const context = extractPostgrestContext(error)
    expect(context).toEqual({ code: 'PGRST301', message: 'JWT expired', details: 'token exp claim is in the past', hint: null })
  })

  it('walks nested cause chain', () => {
    const pgError = { code: 'PGRST204', message: 'Column not found', details: null, hint: null }
    const inner = new Error('inner')
    inner.cause = pgError
    const outer = new Error('outer')
    outer.cause = inner
    const context = extractPostgrestContext(outer)
    expect(context).toEqual({ code: 'PGRST204', message: 'Column not found', details: null, hint: null })
  })

  it('returns null when no PostgREST error in chain', () => {
    const error = new Error('plain error')
    expect(extractPostgrestContext(error)).toBeNull()
  })

  it('returns null for non-PGRST codes', () => {
    const error = new Error('something')
    error.cause = { code: 'OTHER_CODE', message: 'not postgrest' }
    expect(extractPostgrestContext(error)).toBeNull()
  })

  it('handles max depth to prevent infinite loops', () => {
    const a: Error & { cause?: unknown } = new Error('a')
    const b: Error & { cause?: unknown } = new Error('b')
    a.cause = b
    b.cause = a
    expect(extractPostgrestContext(a)).toBeNull()
  })
})

describe('summarizeUpstreamHtmlError', () => {
  it('keeps the caller prefix and collapses the HTML body', () => {
    const message = `Failed to fetch event 2026-taiwan-creative-expo: ${cloudflare522('a29e179b8ba29d12', '2026-08-12 08:26:15 UTC')}`
    expect(summarizeUpstreamHtmlError(message)).toBe(
      'Failed to fetch event 2026-taiwan-creative-expo: <upstream HTML error response: supabase.co | 522: Connection timed out>',
    )
  })

  it('produces the same string for occurrences that differ only by Ray ID and timestamp', () => {
    const first = summarizeUpstreamHtmlError(cloudflare522('a29e1bad5b8e80f7', '2026-08-12 08:29:01 UTC'))
    const second = summarizeUpstreamHtmlError(cloudflare522('a29dc6dd1adb0884', '2026-08-12 07:31:08 UTC'))
    expect(first).toBe(second)
  })

  it('falls back to a generic summary when the page has no title', () => {
    expect(summarizeUpstreamHtmlError('boom: <!DOCTYPE html><html><body>nope</body></html>')).toBe(
      'boom: <upstream HTML error response>',
    )
  })

  it('leaves ordinary error messages untouched', () => {
    expect(summarizeUpstreamHtmlError('Failed to fetch event foo: JWT expired')).toBe(
      'Failed to fetch event foo: JWT expired',
    )
  })
})
