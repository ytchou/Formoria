// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SubmissionsList } from '../submissions-list'

vi.mock('@/app/admin/actions', () => ({
  approveSubmissionAction: vi.fn(),
  rejectSubmissionAction: vi.fn(),
}))

const mockSubmissions = [
  {
    id: 'sub-1',
    brandId: null,
    brandName: 'Pottery Studio',
    submitterEmail: 'potter@test.com',
    submitterName: 'Potter',
    description: 'Handmade ceramics from Yingge',
    websiteUrl: null,
    status: 'pending' as const,
    suggestedTags: ['ceramics', 'handmade'],
    socialLinks: { instagram: '@pottery' },
    submittedAt: '2026-05-18T10:00:00Z',
    reviewedAt: null,
    reviewedBy: null,
    reviewerNotes: null,
    pdpaConsentAt: null,
    validationStatus: null,
    validationErrors: null,
    notifiedAt: null,
    isBrandOwner: false,
  },
  {
    id: 'sub-2',
    brandId: null,
    brandName: 'Tea House',
    submitterEmail: 'tea@test.com',
    submitterName: null,
    description: 'Premium oolong tea',
    websiteUrl: null,
    status: 'approved' as const,
    suggestedTags: ['tea'],
    socialLinks: {},
    submittedAt: '2026-05-17T10:00:00Z',
    reviewedAt: '2026-05-18T10:00:00Z',
    reviewedBy: 'admin-1',
    reviewerNotes: null,
    pdpaConsentAt: null,
    validationStatus: null,
    validationErrors: null,
    notifiedAt: null,
    isBrandOwner: false,
  },
]

describe('SubmissionsList', () => {
  it('renders submission rows', () => {
    render(<SubmissionsList submissions={mockSubmissions} />)
    expect(screen.getByText('Pottery Studio')).toBeDefined()
    expect(screen.getByText('Tea House')).toBeDefined()
  })

  it('renders status filter tabs', () => {
    render(<SubmissionsList submissions={mockSubmissions} />)
    expect(screen.getByRole('tab', { name: /全部/ })).toBeDefined()
    expect(screen.getByRole('tab', { name: /待審核/ })).toBeDefined()
    expect(screen.getByRole('tab', { name: /已核准/ })).toBeDefined()
    expect(screen.getByRole('tab', { name: /已拒絕/ })).toBeDefined()
  })

  it('filters submissions by status tab', () => {
    render(<SubmissionsList submissions={mockSubmissions} />)
    const pendingTab = screen.getByRole('tab', { name: /待審核/ })
    fireEvent.click(pendingTab)
    expect(screen.getByText('Pottery Studio')).toBeDefined()
    expect(screen.queryByText('Tea House')).toBeNull()
  })

  it('expands a row when clicked', () => {
    render(<SubmissionsList submissions={mockSubmissions} />)
    fireEvent.click(screen.getByText('Pottery Studio'))
    expect(screen.getByText('Handmade ceramics from Yingge')).toBeDefined()
  })

  it('shows approve and reject buttons in expanded pending row', () => {
    render(<SubmissionsList submissions={mockSubmissions} />)
    fireEvent.click(screen.getByText('Pottery Studio'))
    expect(screen.getByRole('button', { name: '核准' })).toBeDefined()
    expect(screen.getByRole('button', { name: '拒絕' })).toBeDefined()
  })

  it('shows suggested tags in expanded row', () => {
    render(<SubmissionsList submissions={mockSubmissions} />)
    fireEvent.click(screen.getByText('Pottery Studio'))
    expect(screen.getByText('ceramics')).toBeDefined()
    expect(screen.getByText('handmade')).toBeDefined()
  })

  it('collapses previously expanded row when another is clicked (accordion)', () => {
    render(<SubmissionsList submissions={mockSubmissions} />)
    fireEvent.click(screen.getByText('Pottery Studio'))
    expect(screen.getByText('Handmade ceramics from Yingge')).toBeDefined()

    fireEvent.click(screen.getByText('Tea House'))
    expect(screen.queryByText('Handmade ceramics from Yingge')).toBeNull()
    expect(screen.getByText('Premium oolong tea')).toBeDefined()
  })
})
