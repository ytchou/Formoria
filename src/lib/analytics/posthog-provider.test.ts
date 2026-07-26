import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearPostHogProviderForTests,
  capturePostHogEvent,
  identifyPostHogUser,
  registerPostHogProvider,
  resetPostHogUser,
} from './posthog-provider'

afterEach(clearPostHogProviderForTests)

describe('PostHog provider registry', () => {


  it('does not reapply an identity after logout', () => {
    const first = { capture: vi.fn(), identify: vi.fn(), reset: vi.fn() }
    const replacement = { capture: vi.fn(), identify: vi.fn(), reset: vi.fn() }

    registerPostHogProvider(first)
    identifyPostHogUser('supabase-user-id')
    resetPostHogUser()
    registerPostHogProvider(replacement)

    expect(first.reset).toHaveBeenCalledOnce()
    expect(replacement.identify).not.toHaveBeenCalled()
  })

  it('resets persisted identity and drops buffered events when logout precedes registration', () => {
    const provider = { capture: vi.fn(), identify: vi.fn(), reset: vi.fn() }

    capturePostHogEvent('brand_search_executed', { query_length: 3 })
    resetPostHogUser()
    registerPostHogProvider(provider)

    expect(provider.reset).toHaveBeenCalledOnce()
    expect(provider.capture).not.toHaveBeenCalled()
    expect(provider.identify).not.toHaveBeenCalled()
  })
})
