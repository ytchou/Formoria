// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearPostHogProviderForTests } from './posthog-provider'
import { initializePostHog } from './posthog-client'

afterEach(() => {
  clearPostHogProviderForTests()
  vi.unstubAllEnvs()
})

describe('PostHog client initialization', () => {
  it('uses the managed host and privacy-safe single-pageview configuration', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN', 'phc_test')
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_HOST', 'https://e.formoria.com')
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_UI_HOST', 'https://us.posthog.com')
    const client = { init: vi.fn(), capture: vi.fn(), identify: vi.fn(), reset: vi.fn() }

    expect(initializePostHog(client)).toBe(true)
    expect(client.init).toHaveBeenCalledWith(
      'phc_test',
      expect.objectContaining({
        api_host: 'https://e.formoria.com',
        ui_host: 'https://us.posthog.com',
        capture_pageview: 'history_change',
        capture_pageleave: false,
        capture_exceptions: false,
        capture_performance: false,
        capture_dead_clicks: false,
        rageclick: false,
        disable_session_recording: true,
        mask_all_text: true,
        mask_all_element_attributes: true,
        autocapture: expect.objectContaining({
          dom_event_allowlist: ['click', 'submit'],
          element_allowlist: ['a', 'button', 'form'],
        }),
      }),
    )
  })

  it('does not initialize outside production or without the managed host', () => {
    const client = { init: vi.fn(), capture: vi.fn(), identify: vi.fn(), reset: vi.fn() }
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN', 'phc_test')
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_HOST', 'https://us.i.posthog.com')

    expect(initializePostHog(client)).toBe(false)
    expect(client.init).not.toHaveBeenCalled()
  })
})
