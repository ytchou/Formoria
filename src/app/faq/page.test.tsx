// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import FaqPage from './page'

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))

describe('FaqPage', () => {
  it('renders the 常見問題 heading', () => {
    render(<FaqPage />)
    expect(screen.getByRole('heading', { name: '常見問題' })).toBeInTheDocument()
  })

  it('renders exactly 7 accordion items', () => {
    const { container } = render(<FaqPage />)
    expect(container.querySelectorAll('details')).toHaveLength(7)
  })

  it('each item has a summary child element', () => {
    const { container } = render(<FaqPage />)
    expect(container.querySelectorAll('details > summary')).toHaveLength(7)
  })

  it('includes the 什麼是 Formoria question', () => {
    render(<FaqPage />)
    expect(screen.getByText(/什麼是 Formoria/)).toBeInTheDocument()
  })

  it('includes the 如何提交品牌 question', () => {
    render(<FaqPage />)
    expect(screen.getByText(/如何提交品牌/)).toBeInTheDocument()
  })

  it('includes the 如何聯繫 question', () => {
    render(<FaqPage />)
    expect(screen.getByText(/如何聯繫/)).toBeInTheDocument()
  })

  it('includes FAQPage JSON-LD script tag', () => {
    const { container } = render(<FaqPage />)
    const script = container.querySelector('script[type="application/ld+json"]')
    expect(script).toBeInTheDocument()
    const jsonLd = JSON.parse(script!.textContent!)
    expect(jsonLd['@type']).toBe('FAQPage')
  })
})
