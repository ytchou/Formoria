// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import ConfirmationPage from './page'

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

describe('ConfirmationPage', () => {
  it('renders thank you heading', () => {
    render(<ConfirmationPage />)
    expect(screen.getByText(/感謝您/)).toBeInTheDocument()
  })

  it('explains the review process', () => {
    render(<ConfirmationPage />)
    expect(screen.getByText(/審核中/)).toBeInTheDocument()
    expect(screen.getByText(/3 個工作天/)).toBeInTheDocument()
  })

  it('has a link to the directory', () => {
    render(<ConfirmationPage />)
    const link = screen.getByRole('link', {
      name: /探索 Formoria 目錄/,
    })
    expect(link).toHaveAttribute('href', '/')
  })

  it('shows a 3-step timeline', () => {
    render(<ConfirmationPage />)
    expect(screen.getByText(/審核中/)).toBeInTheDocument()
    expect(screen.getByText(/聯繫/)).toBeInTheDocument()
    expect(screen.getByText(/品牌上線/)).toBeInTheDocument()
  })
})
