// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { BulkImportV2 } from '@/components/admin/bulk-import-v2'

vi.mock('@/app/admin/actions', () => ({
  previewBulkImportAction: vi.fn(),
  executeBulkImportAction: vi.fn(),
}))

const { previewBulkImportAction, executeBulkImportAction } = await import('@/app/admin/actions')

describe('BulkImportV2', () => {
  it('renders file input and preview button', () => {
    render(<BulkImportV2 />)
    expect(screen.getByText('建議每次匯入不超過 200 筆')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '預覽' })).toBeInTheDocument()
  })

  it('shows error message when previewBulkImportAction returns error', async () => {
    vi.mocked(previewBulkImportAction).mockResolvedValue({ error: 'No rows found in CSV', rows: [] })
    render(<BulkImportV2 />)
    const file = new File([''], 'brands.csv', { type: 'text/csv' })
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [file] } })
    fireEvent.click(screen.getByRole('button', { name: '預覽' }))
    await waitFor(() => expect(screen.getByText(/no rows found/i)).toBeInTheDocument())
  })

  it('shows preview table with rows after successful preview', async () => {
    vi.mocked(previewBulkImportAction).mockResolvedValue({
      rows: [
        { rowIndex: 1, name: 'Taiwan Tea', slug: 'taiwan-tea', status: 'valid', validatedData: {} as never },
        { rowIndex: 2, name: 'Old Brand', slug: 'old-brand', status: 'duplicate', reason: '可能與「Old Brand Co」重複', validatedData: {} as never },
      ],
    })
    render(<BulkImportV2 />)
    const file = new File(['name,description\n...'], 'brands.csv', { type: 'text/csv' })
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [file] } })
    fireEvent.click(screen.getByRole('button', { name: '預覽' }))
    await waitFor(() => {
      expect(screen.getByText('Taiwan Tea')).toBeInTheDocument()
      expect(screen.getByText('Old Brand')).toBeInTheDocument()
      const checkboxes = screen.getAllByRole('checkbox')
      expect(checkboxes[1]).toBeChecked()
      expect(checkboxes[2]).not.toBeChecked()
    })
    expect(screen.getByRole('button', { name: '匯入已選' })).toBeInTheDocument()
  })

  it('shows results table after import', async () => {
    vi.mocked(previewBulkImportAction).mockResolvedValue({
      rows: [{ rowIndex: 1, name: 'Taiwan Tea', slug: 'taiwan-tea', status: 'valid', validatedData: {} as never }],
    })
    vi.mocked(executeBulkImportAction).mockResolvedValue({
      results: [{ rowIndex: 1, name: 'Taiwan Tea', status: 'created' }],
    })
    render(<BulkImportV2 />)
    const file = new File(['name\nTaiwan Tea'], 'brands.csv', { type: 'text/csv' })
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [file] } })
    fireEvent.click(screen.getByRole('button', { name: '預覽' }))
    await waitFor(() => screen.getByRole('button', { name: '匯入已選' }))
    fireEvent.click(screen.getByRole('button', { name: '匯入已選' }))
    await waitFor(() => expect(screen.getAllByText('已建立').length).toBeGreaterThan(0))
  })
})
