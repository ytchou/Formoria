import { describe, it, expect } from 'vitest'
import { extractPostgrestContext } from '../sentry.server.config'

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
