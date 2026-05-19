// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import ConfirmationPage from './page'

// Mock next/link to a simple anchor
vi.mock('next/link', () => ({
  default: ({
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
    expect(screen.getByText(/thank you/i)).toBeInTheDocument()
  })

  it('explains the review process', () => {
    render(<ConfirmationPage />)
    expect(screen.getByText(/review in progress/i)).toBeInTheDocument()
    expect(screen.getByText(/3 business days/i)).toBeInTheDocument()
  })

  it('has a link to the directory', () => {
    render(<ConfirmationPage />)
    const link = screen.getByRole('link', {
      name: /explore.*mit map|mit map.*directory/i,
    })
    expect(link).toHaveAttribute('href', '/')
  })

  it('shows a 3-step timeline', () => {
    render(<ConfirmationPage />)
    expect(screen.getByText(/review in progress/i)).toBeInTheDocument()
    expect(screen.getByText(/reach out/i)).toBeInTheDocument()
    expect(screen.getByText(/goes live/i)).toBeInTheDocument()
  })
})
