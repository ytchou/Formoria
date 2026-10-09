import { describe, expect, it } from 'vitest'

import { hasSupabaseAuthCookie } from './auth-cookie'

describe('hasSupabaseAuthCookie', () => {
  it('finds a single session cookie', () => {
    expect(hasSupabaseAuthCookie('sb-xkcayngbttpxyibgzern-auth-token=base64-eyJ')).toBe(true)
  })

  it('finds a chunked session cookie among others', () => {
    expect(
      hasSupabaseAuthCookie(
        'fm_visitor=abc; sb-ttkkyvgvcamfoezsetvf-auth-token.0=base64-eyJ; sb-ttkkyvgvcamfoezsetvf-auth-token.1=fQ',
      ),
    ).toBe(true)
  })

  it('is false for an anonymous visitor', () => {
    expect(hasSupabaseAuthCookie('')).toBe(false)
    expect(hasSupabaseAuthCookie('fm_visitor=abc; _ga=GA1.1.1')).toBe(false)
  })

  it('ignores the PKCE verifier, which exists before any session does', () => {
    expect(hasSupabaseAuthCookie('sb-ref-auth-token-code-verifier=xyz')).toBe(false)
  })

  it('ignores a cleared cookie and look-alike names', () => {
    expect(hasSupabaseAuthCookie('sb-ref-auth-token=')).toBe(false)
    expect(hasSupabaseAuthCookie('xsb-ref-auth-token=1; sb-auth-token=1')).toBe(false)
  })
})
