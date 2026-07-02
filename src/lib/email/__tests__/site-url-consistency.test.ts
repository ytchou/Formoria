import { afterEach, describe, expect, it, vi } from 'vitest'

describe('email site url consistency', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('resolves the same site url from email modules and src/lib/site-url when env is unset', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '')

    const [{ SITE_URL: stylesSiteUrl }, { SITE_URL: utilsSiteUrl }, { getSiteUrl }] = await Promise.all([
      import('../../../../emails/styles'),
      import('../../../../emails/utils'),
      import('../../site-url'),
    ])

    expect(stylesSiteUrl).toBe(getSiteUrl())
    expect(utilsSiteUrl).toBe(getSiteUrl())
    expect(stylesSiteUrl).toBe(utilsSiteUrl)
    expect(stylesSiteUrl).toBe('http://localhost:3000')
  })
})
