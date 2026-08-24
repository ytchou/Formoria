import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  isRateLimitDisabled,
  isTurnstileStubbed,
  RATE_LIMIT_DISABLED_ENV,
  TURNSTILE_STUBBED_ENV,
} from '../test-gates'

/**
 * DEV-1551 task 17. One flag used to disable both the rate limiter and
 * Turnstile, and `playwright.config.ts` baked it into a SHARED web server, so no
 * Playwright project could turn either gate back on. These tests pin the two
 * properties that make the adversarial e2e matrix possible: the switches are
 * independent, and neither changes today's effective behaviour by default.
 */
describe('granular security test gates', () => {
  afterEach(() => vi.unstubAllEnvs())

  function clearAll(): void {
    vi.stubEnv(RATE_LIMIT_DISABLED_ENV, '')
    vi.stubEnv(TURNSTILE_STUBBED_ENV, '')
    vi.stubEnv('PLAYWRIGHT_TEST', '')
  }

  it('rate-limit gates stay off under the existing default', () => {
    // Exactly what a spec sees today: the legacy flag alone, no new switches.
    clearAll()
    vi.stubEnv('PLAYWRIGHT_TEST', 'true')

    expect(isRateLimitDisabled()).toBe(true)
    expect(isTurnstileStubbed()).toBe(true)
  })

  it('both gates are armed when nothing is set', () => {
    clearAll()

    expect(isRateLimitDisabled()).toBe(false)
    expect(isTurnstileStubbed()).toBe(false)
  })

  it('limiter can be enabled while Turnstile stays stubbed', () => {
    clearAll()
    vi.stubEnv('PLAYWRIGHT_TEST', 'true')
    vi.stubEnv(RATE_LIMIT_DISABLED_ENV, 'false')

    expect(isRateLimitDisabled()).toBe(false)
    expect(isTurnstileStubbed()).toBe(true)
  })

  it('Turnstile can be enabled while the limiter stays off', () => {
    clearAll()
    vi.stubEnv('PLAYWRIGHT_TEST', 'true')
    vi.stubEnv(TURNSTILE_STUBBED_ENV, 'false')

    expect(isTurnstileStubbed()).toBe(false)
    expect(isRateLimitDisabled()).toBe(true)
  })

  it('an explicit switch wins over the legacy flag in both directions', () => {
    clearAll()
    vi.stubEnv('PLAYWRIGHT_TEST', 'false')
    vi.stubEnv(RATE_LIMIT_DISABLED_ENV, 'true')
    vi.stubEnv(TURNSTILE_STUBBED_ENV, '1')

    expect(isRateLimitDisabled()).toBe(true)
    expect(isTurnstileStubbed()).toBe(true)
  })

  it('a typo is treated as unset, never as "disabled"', () => {
    clearAll()
    // The dangerous direction: a misspelling must not switch a gate off on a
    // deployed environment.
    vi.stubEnv(RATE_LIMIT_DISABLED_ENV, 'ture')
    vi.stubEnv(TURNSTILE_STUBBED_ENV, 'enabled')

    expect(isRateLimitDisabled()).toBe(false)
    expect(isTurnstileStubbed()).toBe(false)
  })
})
