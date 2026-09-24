import { afterEach, describe, expect, it, vi } from 'vitest'

import { shouldReportMissingProvider } from './web-vitals-reporter'

describe('shouldReportMissingProvider', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('reports on the production host', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(shouldReportMissingProvider('formoria.com')).toBe(true)
  })

  // Staging runs a production build with no PostHog key by design. Reporting
  // there sent one Sentry event per page load and exhausted the org's error
  // quota, which dropped every production error with it (DEV-1851).
  it('stays silent on the staging host', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(shouldReportMissingProvider('staging.formoria.com')).toBe(false)
  })

  it('stays silent outside a production build', () => {
    vi.stubEnv('NODE_ENV', 'development')
    expect(shouldReportMissingProvider('formoria.com')).toBe(false)
  })
})
