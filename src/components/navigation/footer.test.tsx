// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { Footer } from './footer'

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) => {
    const map: Record<string, string> = {
      discoverHeading: '探索',
      directory: '品牌目錄',
      categories: '分類瀏覽',
      gettingStarted: '開始使用',
      submit: '提交品牌',
      companyHeading: '關於',
      about: '關於我們',
      faq: '常見問題',
      support: '支持我們',
      legalHeading: '法律',
      terms: '服務條款',
      connectHeading: '聯絡',
      contact: '聯絡我們',
      tagline: '讓台灣品牌被世界看見。',
      copyright: `© ${params?.year ?? new Date().getFullYear()} Formoria`,
    }
    return map[key] ?? key
  },
}))

describe('Footer', () => {
  it('renders a semantic footer element', () => {
    render(<Footer />)
    expect(screen.getByRole('contentinfo')).toBeInTheDocument()
  })

  it('renders 關於我們 link pointing to /about', () => {
    render(<Footer />)
    expect(screen.getByRole('link', { name: '關於我們' })).toHaveAttribute('href', '/about')
  })

  it('renders 開始使用 link pointing to /getting-started', () => {
    render(<Footer />)
    expect(screen.getByRole('link', { name: '開始使用' })).toHaveAttribute('href', '/getting-started')
  })

  it('renders 服務條款 link pointing to /terms', () => {
    render(<Footer />)
    expect(screen.getByRole('link', { name: '服務條款' })).toHaveAttribute('href', '/terms')
  })

  it('renders 聯絡我們 as a mailto link', () => {
    render(<Footer />)
    const link = screen.getByRole('link', { name: '聯絡我們' })
    expect(link.getAttribute('href')).toMatch(/^mailto:/)
  })

  it('renders copyright text containing Formoria', () => {
    render(<Footer />)
    expect(screen.getByText(/Formoria/)).toBeInTheDocument()
  })
})
