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

  it('sanitizeJobError redacts Basic authorization and GitHub tokens without removing diagnostics', () => {
    const credentials = [
      'ghp_personalAccessToken123',
      'gho_oauthAccessToken123',
      'ghu_userAccessToken123',
      'ghs_serverAccessToken123',
      'ghr_refreshToken123',
      'github_pat_fineGrainedToken123',
    ]
    const error = new Error(
      `fatal: Authentication failed. Authorization: Basic c3VwZXItc2VjcmV0 ${credentials.join(' ')}`,
    )

    const sanitized = sanitizeJobError(error)

    expect(sanitized).toContain('fatal: Authentication failed.')
    expect(sanitized).toContain('Authorization: Basic [REDACTED]')
    expect(sanitized).not.toContain('c3VwZXItc2VjcmV0')
    for (const credential of credentials) {
      expect(sanitized).not.toContain(credential)
    }
  })
})
