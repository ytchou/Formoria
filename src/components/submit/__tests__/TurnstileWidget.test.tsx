/**
 * @vitest-environment jsdom
 */
import { render } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TurnstileWidget } from '../TurnstileWidget'

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
