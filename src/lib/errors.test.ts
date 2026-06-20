import { describe, expect, it } from 'vitest'
import { ServiceError, NotFoundError, ValidationError, sanitizeErrorResponse } from './errors'

describe('ServiceError', () => {
  it('stores message and code', () => {
    const err = new ServiceError('something failed', 'GENERIC')
    expect(err.message).toBe('something failed')
    expect(err.code).toBe('GENERIC')
    expect(err).toBeInstanceOf(Error)
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

describe('ValidationError', () => {
  it('uses VALIDATION_ERROR code', () => {
    const err = new ValidationError('slug already exists')
    expect(err.message).toBe('slug already exists')
    expect(err.code).toBe('VALIDATION_ERROR')
    expect(err).toBeInstanceOf(ServiceError)
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
