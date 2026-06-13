// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PendingEditsPage from './page'
import { getPendingEditCount, getPendingEdits } from '@/lib/services/pending-edits'

vi.mock('@/lib/services/pending-edits', () => ({
  getPendingEdits: vi.fn(),
  getPendingEditCount: vi.fn(),
}))

vi.mock('@/components/admin/pending-edits-list', () => ({
  PendingEditsList: () => <div data-testid="pending-edits-list" />,
}))

beforeEach(() => {
  vi.mocked(getPendingEdits).mockResolvedValue([])
  vi.mocked(getPendingEditCount).mockResolvedValue(0)
})

describe('PendingEditsPage', () => {
  it('renders the page heading', async () => {
    render(await PendingEditsPage())
    expect(screen.getByRole('heading', { name: /品牌編輯審核/ })).toBeInTheDocument()
  })

  it('renders PendingEditsList', async () => {
    render(await PendingEditsPage())
    expect(screen.getByTestId('pending-edits-list')).toBeInTheDocument()
  })

  it('shows the pending count', async () => {
    vi.mocked(getPendingEditCount).mockResolvedValueOnce(3)
    render(await PendingEditsPage())
    expect(screen.getByText(/待審核：3 件/)).toBeInTheDocument()
  })
})
