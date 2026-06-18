// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import zh from '../../../../../messages/zh-TW.json'

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(),
  setRequestLocale: vi.fn(),
}))

vi.mock('@/i18n/navigation', () => ({
  Link: ({
    href,
    children,
    className,
  }: {
    href: string
    children: ReactNode
    className?: string
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}))

import { getTranslations } from 'next-intl/server'
import ConfirmationPage from './page'

type Messages = typeof zh

function makeT(messages: Messages, namespace: string) {
  const translate = (key: string, values: Record<string, unknown> = {}) => {
    const parts = `${namespace}.${key}`.split('.')
    let current: unknown = messages

    for (const part of parts) {
      if (typeof current !== 'object' || current === null) return key
      current = (current as Record<string, unknown>)[part]
    }

    if (typeof current !== 'string') return key

    return current.replace(/\{(\w+)\}/g, (_match, name: string) =>
      typeof values[name] === 'function' ? '' : String(values[name] ?? `{${name}}`)
    )
  }

  return (key: string, values?: Record<string, unknown>) => translate(key, values)
}

function setupMocks(messages: Messages) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(getTranslations).mockImplementation(async (namespace: any) => {
    const t = makeT(messages, typeof namespace === 'string' ? namespace : '')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return t as any
  })
}

describe('ConfirmationPage (zh-TW)', () => {
  beforeEach(() => {
    setupMocks(zh as Messages)
  })

  it('includes FAQPage JSON-LD script tag for the what next items', async () => {
    const { container } = render(
      await ConfirmationPage({ params: Promise.resolve({ locale: 'zh-TW' }) })
    )

    const script = container.querySelector('script[type="application/ld+json"]')
    expect(script).toBeInTheDocument()

    const jsonLd = JSON.parse(script!.textContent!)
    expect(jsonLd['@type']).toBe('FAQPage')
    expect(jsonLd.mainEntity).toHaveLength(4)
    expect(jsonLd.mainEntity[0]['@type']).toBe('Question')
  })
})
