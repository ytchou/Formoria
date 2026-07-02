// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('@/app/admin/actions', () => ({
  reviewReportAction: vi.fn(),
}))

import { ReportsTable } from '../reports-table'
import type { BrandReport } from '@/lib/services/reports'

const mockReports: BrandReport[] = [
  {
    id: 'r1',
    brandId: 'b1',
    brandName: 'Test Brand',
    brandSlug: 'test-brand',
    reason: 'not_mit',
    notes: null,
    status: 'pending',
    reviewedAt: null,
    createdAt: '2026-05-29T00:00:00.000Z',
  },
]

describe('ReportsTable', () => {
  it('renders the brand name', () => {
    render(<ReportsTable reports={mockReports} />)
    expect(screen.getByText('Test Brand')).toBeInTheDocument()
  })

  it('renders the reason in Chinese', () => {
    render(<ReportsTable reports={mockReports} />)
    expect(screen.getByText('非台灣製造')).toBeInTheDocument()
  })

  it('renders Review and Dismiss buttons after expanding row', () => {
    render(<ReportsTable reports={mockReports} />)
    fireEvent.click(screen.getByText('非台灣製造'))
    expect(screen.getByRole('button', { name: /審核/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /忽略/i })).toBeInTheDocument()
  })

  it('renders empty state when no reports', () => {
    render(<ReportsTable reports={[]} />)
    expect(screen.getByText(/沒有待處理/i)).toBeInTheDocument()
  })
})
