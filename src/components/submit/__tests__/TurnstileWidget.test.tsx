/**
 * @vitest-environment jsdom
 */
import { render } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TurnstileWidget, turnstileSizeFor } from '../TurnstileWidget'

// The script tag is irrelevant here: window.turnstile is stubbed, so the mount effect renders.
vi.mock('next/script', () => ({ default: () => null }))

describe('TurnstileWidget language', () => {
  const renderSpy = vi.fn<NonNullable<Window['turnstile']>['render']>(() => 'widget-id')

  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'test-site-key')
    window.turnstile = { render: renderSpy, remove: vi.fn() }
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    renderSpy.mockClear()
    delete window.turnstile
  })

  it.each([
    ['en', 'en'],
    ['zh-TW', 'zh-tw'],
  ])('renders the widget in the %s site language', (locale, expected) => {
    render(
      <NextIntlClientProvider locale={locale} messages={{}}>
        <TurnstileWidget onSuccess={() => {}} />
      </NextIntlClientProvider>,
    )

    expect(renderSpy).toHaveBeenCalledTimes(1)
    expect(renderSpy).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({ sitekey: 'test-site-key', language: expected }),
    )
  })
})

describe('turnstileSizeFor', () => {
  it.each([
    [0, 'compact'],
    [272, 'compact'],
    [299, 'compact'],
    [300, 'flexible'],
    [480, 'flexible'],
  ] as const)('returns %s px -> %s', (width, expected) => {
    expect(turnstileSizeFor(width)).toBe(expected)
  })
})

describe('TurnstileWidget size', () => {
  const renderSpy = vi.fn<NonNullable<Window['turnstile']>['render']>(() => 'widget-id')
  const originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')

  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'test-site-key')
    window.turnstile = { render: renderSpy, remove: vi.fn() }
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    renderSpy.mockClear()
    delete window.turnstile
    // jsdom defines clientWidth on Element.prototype, so the stub is usually an own
    // property added here; drop it rather than leaving it to leak into later tests.
    if (originalClientWidth) {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalClientWidth)
    } else {
      delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth
    }
  })

  function stubClientWidth(width: number) {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => width,
    })
  }

  it.each([
    [272, 'compact'],
    [320, 'flexible'],
  ] as const)('renders a %spx container as %s', (width, expected) => {
    stubClientWidth(width)
    render(
      <NextIntlClientProvider locale="en" messages={{}}>
        <TurnstileWidget onSuccess={() => {}} />
      </NextIntlClientProvider>,
    )

    expect(renderSpy).toHaveBeenCalledTimes(1)
    expect(renderSpy).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({ size: expected }),
    )
  })
})
