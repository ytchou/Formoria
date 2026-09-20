import { describe, expect, it } from 'vitest'
import {
  ExternalServiceError,
  ServiceError,
  NotFoundError,
  ValidationError,
  sanitizeErrorResponse,
} from './errors'

describe('ExternalServiceError', () => {
  it('keeps a bounded provider explanation without URLs or secret assignments', () => {
    const error = new ExternalServiceError(
      'github',
      'list_dependabot_alerts',
      403,
      `  Access denied at https://api.github.com/private\n token = ghp_private ${'x'.repeat(400)}`,
    )

    expect(error).toMatchObject({
      provider: 'github',
      operation: 'list_dependabot_alerts',
      httpStatus: 403,
    })
    expect(error.safeMessage).toContain('Access denied at [redacted-url]')
    expect(error.safeMessage).toContain('token=[redacted]')
    expect(error.safeMessage).not.toContain('ghp_private')
    expect(error.safeMessage).not.toContain('api.github.com')
    expect(error.safeMessage).not.toMatch(/\s{2,}/)
    expect(Array.from(error.safeMessage ?? '')).toHaveLength(300)
    expect(error.message).toContain(error.safeMessage ?? '')
  })
})

describe('ServiceError', () => {
  it('stores message and code', () => {
    const err = new ServiceError('something failed', 'GENERIC')
    expect(err.message).toBe('something failed')
    expect(err.code).toBe('GENERIC')
    expect(err).toBeInstanceOf(Error)
  })
})

describe('ServiceError cause chain', () => {
  it('preserves cause when provided', () => {
    const original = new Error('PostgREST: relation not found')
    const wrapped = new ServiceError('Service failed', 'DB_ERROR', {
      cause: original,
    })
    expect(wrapped.message).toBe('Service failed')
    expect(wrapped.code).toBe('DB_ERROR')
    expect(wrapped.cause).toBe(original)
  })

  it('works without cause (backward compatible)', () => {
    const err = new ServiceError('Service failed', 'DB_ERROR')
    expect(err.message).toBe('Service failed')
    expect(err.code).toBe('DB_ERROR')
    expect(err.cause).toBeUndefined()
  })
})

describe('NotFoundError', () => {
  it('formats entity and identifier into message', () => {
    const err = new NotFoundError('Brand', 'cool-brand')
    expect(err.message).toBe('Brand not found: cool-brand')
    expect(err.code).toBe('NOT_FOUND')
    expect(err).toBeInstanceOf(ServiceError)
  })
})

describe('NotFoundError cause chain', () => {
  it('preserves cause through to base class', () => {
    const pgError = { code: 'PGRST116', message: 'no rows', details: null, hint: null }
    const err = new NotFoundError('Brand', 'test-slug', { cause: pgError })
    expect(err.message).toContain('Brand')
    expect(err.message).toContain('test-slug')
    expect(err.code).toBe('NOT_FOUND')
    expect(err.cause).toBe(pgError)
  })

  it('works without cause (backward compatible)', () => {
    const err = new NotFoundError('Brand', 'test-slug')
    expect(err.cause).toBeUndefined()
  })
})

describe('ValidationError', () => {
  it('uses VALIDATION_ERROR code', () => {
    const err = new ValidationError('slug already exists')
    expect(err.message).toBe('slug already exists')
    expect(err.code).toBe('VALIDATION_ERROR')
    expect(err).toBeInstanceOf(ServiceError)
  })
})

describe('ValidationError cause chain', () => {
  it('preserves cause through to base class', () => {
    const original = new Error('constraint violation')
    const err = new ValidationError('Invalid input', { cause: original })
    expect(err.cause).toBe(original)
  })
})

describe('sanitizeErrorResponse', () => {
  it('should return generic message with digest', () => {
    const result = sanitizeErrorResponse(new Error('SELECT * FROM users failed'), 'abc123')
    expect(result).toEqual({ error: 'An unexpected error occurred', digest: 'abc123' })
    expect(JSON.stringify(result)).not.toContain('SELECT')
    expect(JSON.stringify(result)).not.toContain('users')
  })

  it('should not leak stack traces', () => {
    const err = new Error('DB connection failed')
    const result = sanitizeErrorResponse(err, 'def456')
    expect(JSON.stringify(result)).not.toContain('at ')
    expect(JSON.stringify(result)).not.toContain('.ts:')
  })

  it('should work without digest', () => {
    const result = sanitizeErrorResponse(new Error('something'))
    expect(result).toEqual({ error: 'An unexpected error occurred' })
  })
})
