// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TrustModel } from '@/components/about/trust-model'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

describe('TrustModel', () => {
  it('renders the trust section heading', () => {
    render(<TrustModel />)
    expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument()
  })

  it('renders all three trust pillars', () => {
    render(<TrustModel />)
    const pillarHeadings = screen.getAllByRole('heading', { level: 3 })
    expect(pillarHeadings).toHaveLength(3)
  })

  it('renders the trust tagline', () => {
    render(<TrustModel />)
    expect(screen.getByText('tagline')).toBeInTheDocument()
  })
})
