// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AdminDashboardPage from '../page'
import { getBrands } from '@/lib/services/brands'
import { getPendingEditCount } from '@/lib/services/pending-edits'
import { getPendingReports } from '@/lib/services/reports'
import { getSubmissions } from '@/lib/services/submissions'
import { getTags } from '@/lib/services/taxonomy'

vi.mock('@/lib/services/submissions', () => ({
  getSubmissions: vi.fn(),
}))

vi.mock('@/lib/services/brands', () => ({
  getBrands: vi.fn(),
}))

vi.mock('@/lib/services/taxonomy', () => ({
  getTags: vi.fn(),
}))

vi.mock('@/lib/services/reports', () => ({
  getPendingReports: vi.fn(),
}))

vi.mock('@/lib/services/pending-edits', () => ({
  getPendingEditCount: vi.fn(),
}))

beforeEach(() => {
  vi.mocked(getSubmissions).mockResolvedValue([])
  vi.mocked(getBrands).mockResolvedValue({
    brands: [],
    totalCount: 0,
  })
  vi.mocked(getTags).mockResolvedValue([])
  vi.mocked(getPendingReports).mockResolvedValue([])
  vi.mocked(getPendingEditCount).mockResolvedValue(0)
})

describe('AdminPage', () => {
  it('should export a default function', async () => {
    const mod = await import('../page')
    expect(typeof mod.default).toBe('function')
  })

  it('shows pending edits count stat card', async () => {
    vi.mocked(getPendingEditCount).mockResolvedValueOnce(5)
    render(await AdminDashboardPage())
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText(/待審核編輯|Pending Edits/)).toBeInTheDocument()
  })
})
