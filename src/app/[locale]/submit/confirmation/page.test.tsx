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

  const t = (key: string, values?: Record<string, unknown>) => translate(key, values)

  t.rich = (key: string, values: Record<string, unknown> = {}) => {
    const raw = translate(key)
    // Strip XML-like tags to return plain text for testing
    const stripped = raw.replace(/<[^>]+>/g, '')
    // Apply any function values (like link wrappers) — just return text
    for (const [, val] of Object.entries(values)) {
      if (typeof val === 'function') {
        // no-op for test: rich tags are stripped
      }
    }
    return stripped
  }

  return t
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

  it('renders confirmation content with timeline and CTAs', async () => {
    const { container } = render(
      await ConfirmationPage({ params: Promise.resolve({ locale: 'zh-TW' }) })
    )

    // Renders the success heading
    const heading = container.querySelector('h1')
    expect(heading).toBeInTheDocument()

    // Renders the two CTA links (explore + submit another)
    const links = container.querySelectorAll('a[href]')
    const hrefs = [...links].map((a) => a.getAttribute('href'))
    expect(hrefs).toContain('/')
    expect(hrefs).toContain('/submit')
    expect(container).toHaveTextContent('我們的團隊通常在 2 個工作天內完成審核')
    expect(container).toHaveTextContent('品牌上架')
    expect(container).toHaveTextContent(
      '審核完成後，通過審核的品牌會出現在 Formoria 目錄中；若您有留下電子郵件，我們會通知您審核結果。',
    )
  })
})
