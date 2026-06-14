// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { describe, expect, it, vi } from 'vitest'
import messages from '../../../../messages/en.json'

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

vi.mock('@/components/ui/accordion', () => ({
  Accordion: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AccordionContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AccordionItem: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  AccordionTrigger: ({ children }: { children: ReactNode }) => <button>{children}</button>,
}))

import { getTranslations } from 'next-intl/server'
import GettingStartedPage from './page'

type Messages = typeof messages

function makeT(translations: Messages, namespace: string) {
  return (key: string) => {
    const parts = `${namespace}.${key}`.split('.')
    let current: unknown = translations

    for (const part of parts) {
      if (typeof current !== 'object' || current === null) return key
      current = (current as Record<string, unknown>)[part]
    }

    return typeof current === 'string' ? current : key
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
vi.mocked(getTranslations).mockImplementation(async (namespace: any) => {
  const t = makeT(messages, typeof namespace === 'string' ? namespace : '')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return t as any
})

async function renderGettingStartedPage() {
  const ui = await GettingStartedPage({ params: Promise.resolve({ locale: 'en' }) })

  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      {ui}
    </NextIntlClientProvider>
  )
}

describe('GettingStartedPage', () => {
  it('renders the getting started guide content', async () => {
    await renderGettingStartedPage()

    expect(screen.getByRole('heading', { name: 'Getting Started guide' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'How Formoria works' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Common questions' })).toBeInTheDocument()

    expect(screen.getByText('Discover Taiwan-made brands')).toBeInTheDocument()
    expect(screen.getByText('Submit or suggest a brand')).toBeInTheDocument()
    expect(screen.getByText('Review and approval')).toBeInTheDocument()
    expect(screen.getByText('Claim and manage your listing')).toBeInTheDocument()

    expect(screen.getByRole('button', { name: 'Who can submit a brand?' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'What information should I prepare?' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'How long does review take?' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'What happens after approval?' })).toBeInTheDocument()

    const submitLinks = screen.getAllByRole('link', { name: 'Submit a brand' })
    expect(submitLinks[0]).toHaveAttribute('href', '/submit')
  })
})
