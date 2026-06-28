// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const mockVerifyMitAction = vi.fn()

vi.mock('@/app/[locale]/(protected)/dashboard/actions', () => ({
  verifyMitAction: (...args: unknown[]) => mockVerifyMitAction(...args),
}))

vi.mock('next-intl', () => ({
  useTranslations: (namespace?: string) => (key: string) => {
    return namespace ? `${namespace}.${key}` : key
  },
}))

import { MitStatusCard } from '../mit-status-card'

const defaultProps = {
  brandId: 'brand-123',
  brandName: 'Test Brand',
  brandSlug: 'test-brand',
  mitStatus: 'unverified' as const,
  isOwner: false,
}

describe('MitStatusCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows cert input and verify button when unverified and isOwner', () => {
    render(<MitStatusCard {...defaultProps} isOwner={true} />)

    expect(screen.getByPlaceholderText('dashboard.mit.certPlaceholder')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'dashboard.mit.verifyButton' })).toBeInTheDocument()
  })

  it('shows cert number when verified', () => {
    render(
      <MitStatusCard
        {...defaultProps}
        mitStatus="verified"
        mitEvidence={{ mit_smile_cert: '01900539-00001' }}
      />
    )

    expect(screen.getByText('01900539-00001')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('dashboard.mit.certPlaceholder')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'dashboard.mit.verifyButton' })).not.toBeInTheDocument()
  })

  it('shows no cert input for non-owners when unverified', () => {
    render(<MitStatusCard {...defaultProps} isOwner={false} />)

    expect(screen.queryByPlaceholderText('dashboard.mit.certPlaceholder')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'dashboard.mit.verifyButton' })).not.toBeInTheDocument()
    // Non-owners see the email CTA link instead
    expect(screen.getByRole('link', { name: 'dashboard.mit.resubmitCta' })).toBeInTheDocument()
  })

  it('calls verifyMitAction with brandId and certNumber on verify click', async () => {
    mockVerifyMitAction.mockResolvedValueOnce(undefined)

    render(<MitStatusCard {...defaultProps} isOwner={true} />)

    const input = screen.getByPlaceholderText('dashboard.mit.certPlaceholder')
    const button = screen.getByRole('button', { name: 'dashboard.mit.verifyButton' })

    fireEvent.change(input, { target: { value: '01900539-00001' } })
    fireEvent.click(button)

    expect(mockVerifyMitAction).toHaveBeenCalledWith('brand-123', '01900539-00001')
  })

  it('shows certNotFound error when cert is not in registry', async () => {
    mockVerifyMitAction.mockResolvedValueOnce({ error: 'cert_not_found' })

    render(<MitStatusCard {...defaultProps} isOwner={true} />)

    const input = screen.getByPlaceholderText('dashboard.mit.certPlaceholder')
    fireEvent.change(input, { target: { value: 'INVALID-CERT' } })
    fireEvent.click(screen.getByRole('button', { name: 'dashboard.mit.verifyButton' }))

    await screen.findByText('dashboard.mit.certNotFound')
  })

  it('verify button is disabled when input is empty', () => {
    render(<MitStatusCard {...defaultProps} isOwner={true} />)

    const button = screen.getByRole('button', { name: 'dashboard.mit.verifyButton' })
    expect(button).toBeDisabled()
  })
})
