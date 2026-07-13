// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { render, screen, within } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { describe, expect, it, vi } from 'vitest'
import messages from '../../../../messages/en.json'
import zhMessages from '../../../../messages/zh-TW.json'

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

vi.mock('@/lib/auth/use-user', () => ({
  useUser: vi.fn(() => ({ user: null, loading: false })),
}))

import { getTranslations } from 'next-intl/server'
import GettingStartedPage from './page'

type Messages = typeof messages
let activeMessages: Messages = messages

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
  const t = makeT(activeMessages, typeof namespace === 'string' ? namespace : '')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return t as any
})

async function renderGettingStartedPage(
  locale = 'en',
  translations: Messages = messages,
) {
  activeMessages = translations
  const ui = await GettingStartedPage({ params: Promise.resolve({ locale }) })

  return render(
    <NextIntlClientProvider locale={locale} messages={translations}>
      {ui}
    </NextIntlClientProvider>
  )
}

describe('GettingStartedPage', () => {
  it('renders the getting started guide content', async () => {
    const { container } = await renderGettingStartedPage()

    expect(screen.getByRole('heading', { name: 'Find your next favorite brand' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'How to explore Formoria' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Common questions' })).not.toBeInTheDocument()
    expect(container.querySelector('[data-accordion-type="multiple"]')).toBeNull()

    expect(screen.getByText('Start with what interests you')).toBeInTheDocument()
    expect(screen.getByText('Open a brand listing')).toBeInTheDocument()
    expect(screen.getByText('Compare the details')).toBeInTheDocument()
    expect(screen.getByText('Save brands for later')).toBeInTheDocument()

    const discoverCard = screen.getByRole('heading', { name: 'Start with what interests you' }).closest('article')
    const submitCard = screen.getByRole('heading', { name: 'Open a brand listing' }).closest('article')
    expect(discoverCard).not.toBeNull()
    expect(submitCard).not.toBeNull()
    expect(within(discoverCard as HTMLElement).getByRole('link', { name: 'Browse brands' })).toHaveAttribute(
      'href',
      '/brands',
    )
    expect(within(submitCard as HTMLElement).getByRole('link', { name: 'Explore brands' })).toHaveAttribute(
      'href',
      '/brands',
    )
    expect(
      screen.getByText(
        'Keep brands you want to revisit in your saved list, then return when you are ready to learn more or shop.',
      ),
    ).toBeInTheDocument()

    expect(
      screen
        .getAllByRole('link', { name: 'Read the FAQ' })
        .every((link) => link.getAttribute('href') === '/faq'),
    ).toBe(true)
  })

  it('uses localized copy for the zh-TW guide', async () => {
    await renderGettingStartedPage('zh-TW', zhMessages)

    expect(screen.getByRole('heading', { name: '找到下一個喜歡的品牌' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '新手指南' })).not.toBeInTheDocument()
    expect(
      screen
        .getAllByRole('link', { name: '瀏覽品牌' })
        .every((link) => link.getAttribute('href') === '/brands'),
    ).toBe(true)
  })
})
