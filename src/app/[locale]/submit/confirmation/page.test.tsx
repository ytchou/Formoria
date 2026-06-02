// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import zh from '../../../../../messages/zh-TW.json'

// Mock next-intl/server before importing the page
vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(),
  setRequestLocale: vi.fn(),
}))

// Mock localized Link to a simple anchor
vi.mock('@/i18n/navigation', () => ({
  Link: ({
    href,
    children,
    className,
  }: {
    href: string
    children: React.ReactNode
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
  return (key: string) => {
    const parts = `${namespace}.${key}`.split('.')
    let current: unknown = messages
    for (const part of parts) {
      if (typeof current !== 'object' || current === null) return key
      current = (current as Record<string, unknown>)[part]
    }
    return typeof current === 'string' ? current : key
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
vi.mocked(getTranslations).mockImplementation(async (namespace: any) => {
  const t = makeT(zh as Messages, typeof namespace === 'string' ? namespace : '')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return t as any
})

async function renderConfirmationPage() {
  const ui = await ConfirmationPage({ params: Promise.resolve({ locale: 'zh-TW' }) })
  return render(
    <NextIntlClientProvider locale="zh-TW" messages={zh}>
      {ui}
    </NextIntlClientProvider>
  )
}

describe('ConfirmationPage', () => {
  it('renders thank you heading', async () => {
    await renderConfirmationPage()
    expect(screen.getByText(/感謝您/)).toBeInTheDocument()
  })

  it('explains the review process', async () => {
    await renderConfirmationPage()
    // timeline.review.label = "審核中", timeline.review.description mentions "3 個工作天"
    expect(screen.getByText(/審核中/)).toBeInTheDocument()
    expect(screen.getByText(/3 個工作天/)).toBeInTheDocument()
  })

  it('has a link to the directory', async () => {
    await renderConfirmationPage()
    // cta.explore = "探索 Formoria 目錄"
    const link = screen.getByRole('link', {
      name: /探索 Formoria 目錄/,
    })
    expect(link).toHaveAttribute('href', '/')
  })

  it('shows a 3-step timeline', async () => {
    await renderConfirmationPage()
    // timeline labels: "審核中", "如有需要，我們會與您聯繫", "您的品牌上線"
    expect(screen.getByText(/審核中/)).toBeInTheDocument()
    expect(screen.getByText(/聯繫/)).toBeInTheDocument()
    expect(screen.getByText(/品牌上線/)).toBeInTheDocument()
  })
})
