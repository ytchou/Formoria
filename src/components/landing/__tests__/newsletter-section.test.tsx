// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NewsletterSection } from '../newsletter-section'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => <img {...props} />,
}))

vi.mock('../../newsletter/email-capture-form', () => ({
  EmailCaptureForm: () => <div data-testid="email-capture-form" />,
}))

describe('NewsletterSection', () => {
  it('renders heading', () => {
    render(<NewsletterSection />)
    expect(screen.getByRole('heading')).toBeInTheDocument()
  })

  it('renders the email capture form', () => {
    render(<NewsletterSection />)
    expect(screen.getByTestId('email-capture-form')).toBeInTheDocument()
  })

  it('has background overlay', () => {
    const { container } = render(<NewsletterSection />)
    const overlay = container.querySelector('.bg-black\\/55')
    expect(overlay).toBeInTheDocument()
  })
})
