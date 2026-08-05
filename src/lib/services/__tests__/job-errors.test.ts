import { describe, expect, it } from 'vitest'
import { sanitizeJobError } from '../job-errors'

describe('sanitizeJobError', () => {
  it('sanitizeJobError accepts a max-length parameter', () => {
    const error = new Error('x'.repeat(2_500))

    expect(sanitizeJobError(error)).toHaveLength(2_000)
    expect(sanitizeJobError(error, 1_000)).toHaveLength(1_000)
  })

  it('sanitizeJobError redacts Postgres connection-string passwords at the 1000-char length', () => {
    const error = new Error(
      `postgresql://registry_user:registry-secret@db.example.com/${'x'.repeat(2_000)}`,
    )

    const sanitized = sanitizeJobError(error, 1_000)

    expect(sanitized).toContain('postgresql://registry_user:[REDACTED]@db.example.com/')
    expect(sanitized).not.toContain('registry-secret')
    expect(sanitized).toHaveLength(1_000)
  })
})
