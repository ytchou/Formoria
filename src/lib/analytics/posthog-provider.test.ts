import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearPostHogProviderForTests,
  capturePostHogEvent,
  identifyPostHogUser,
  registerPostHogProvider,
  registerPostHogSuperProperties,
  resetPostHogUser,
} from './posthog-provider'

afterEach(clearPostHogProviderForTests)

describe('PostHog provider registry', () => {


  it('re-applies super properties after a logout reset clears them', () => {
    // posthog-js `reset()` drops super properties along with the identity, but
    // locale describes the device, not the user. Without the re-apply, every
    // post-sign-out event falls back to fragile pathname locale inference.
    const provider = { capture: vi.fn(), identify: vi.fn(), reset: vi.fn(), register: vi.fn() }

    registerPostHogProvider(provider)
    registerPostHogSuperProperties({ locale: 'en' })
    provider.register.mockClear()

    resetPostHogUser()

    expect(provider.reset).toHaveBeenCalledOnce()
    expect(provider.register).toHaveBeenCalledWith({ locale: 'en' })
  })

  it('survives a logout reset when the provider has no register method', () => {
    const provider = { capture: vi.fn(), identify: vi.fn(), reset: vi.fn() }

    registerPostHogProvider(provider)
    registerPostHogSuperProperties({ locale: 'en' })

    expect(() => resetPostHogUser()).not.toThrow()
    expect(provider.reset).toHaveBeenCalledOnce()
  })

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

  it('replays super properties registered before a provider exists', () => {
    const provider = {
      capture: vi.fn(),
      identify: vi.fn(),
      register: vi.fn(),
      reset: vi.fn(),
    }

    registerPostHogSuperProperties({ locale: 'en' })
    registerPostHogProvider(provider)

    expect(provider.register).toHaveBeenCalledWith({ locale: 'en' })
  })

  it('merges successive super property registrations instead of overwriting', () => {
    const provider = {
      capture: vi.fn(),
      identify: vi.fn(),
      register: vi.fn(),
      reset: vi.fn(),
    }

    registerPostHogSuperProperties({ locale: 'en' })
    registerPostHogSuperProperties({ fixture_key: 'fixture-value' })
    registerPostHogProvider(provider)

    expect(provider.register).toHaveBeenCalledWith({
      locale: 'en',
      fixture_key: 'fixture-value',
    })
  })

  it('does not throw when the provider has no register method', () => {
    const provider = { capture: vi.fn(), identify: vi.fn(), reset: vi.fn() }

    registerPostHogProvider(provider)

    expect(() => registerPostHogSuperProperties({ locale: 'en' })).not.toThrow()
  })
})
