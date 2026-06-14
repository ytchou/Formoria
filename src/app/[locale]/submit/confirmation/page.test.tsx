// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { describe, expect, it, vi } from 'vitest'
import messages from '../../../../../messages/en.json'

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

type Messages = typeof messages

function makeT(translations: Messages, namespace: string) {
  const translate = (key: string, values: Record<string, unknown> = {}) => {
    const parts = `${namespace}.${key}`.split('.')
    let current: unknown = translations

    for (const part of parts) {
      if (typeof current !== 'object' || current === null) return key
      current = (current as Record<string, unknown>)[part]
    }

    if (typeof current !== 'string') return key

    return current.replace(/\{(\w+)\}/g, (_match, name: string) =>
      String(values[name] ?? `{${name}}`)
    )
  }

  const rich = (key: string, values: Record<string, unknown> = {}) => {
    const raw = translate(key)
    const segments: ReactNode[] = []
    let remaining = raw

    while (remaining.includes('{link}')) {
      const [before, after] = remaining.split('{link}', 2)
      if (before) segments.push(before)
      const link = values.link
      segments.push(typeof link === 'function' ? (link as () => ReactNode)() : (link as ReactNode))
      remaining = after
    }

    if (remaining) segments.push(remaining)
    return segments.length === 1 ? segments[0] : segments
  }

  return Object.assign((key: string, values?: Record<string, unknown>) => translate(key, values), { rich })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
vi.mocked(getTranslations).mockImplementation(async (namespace: any) => {
  const t = makeT(messages, typeof namespace === 'string' ? namespace : '')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return t as any
})

async function renderConfirmationPage() {
  const ui = await ConfirmationPage({ params: Promise.resolve({ locale: 'en' }) })

  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      {ui}
    </NextIntlClientProvider>
  )
}

describe('ConfirmationPage', () => {
  it('renders the what happens next FAQ section', async () => {
    await renderConfirmationPage()

    expect(screen.getByRole('heading', { name: 'What Happens Next' })).toBeInTheDocument()

    expect(screen.getByText('How long does review take?')).toBeInTheDocument()
    expect(screen.getByText('How will I be contacted?')).toBeInTheDocument()
    expect(screen.getByText('What happens after approval?')).toBeInTheDocument()
    expect(screen.getByText('Want to learn more?')).toBeInTheDocument()

    expect(
      screen.getByText('Our team typically completes reviews within 3 business days.')
    ).toBeInTheDocument()
    expect(screen.getByText("We'll reach out via the email address you provided.")).toBeInTheDocument()
    expect(
      screen.getByText('Your brand will appear in the Formoria directory for visitors to discover.')
    ).toBeInTheDocument()
    expect(screen.getByText('Visit our', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('for a complete overview.', { exact: false })).toBeInTheDocument()

    const link = screen.getByRole('link', { name: 'Getting Started guide' })
    expect(link).toHaveAttribute('href', expect.stringContaining('/getting-started'))
  })
})
