// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { BulkImportForm } from '@/components/admin/bulk-import-form'

vi.mock('@/app/admin/actions', () => ({
  previewBulkImportAction: vi.fn(),
  executeBulkImportAction: vi.fn(),
}))

const { previewBulkImportAction, executeBulkImportAction } = await import('@/app/admin/actions')

describe('BulkImportForm', () => {
  it('renders textarea and preview button', () => {
    render(<BulkImportForm />)
    expect(screen.getByRole('textbox')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /preview/i })).toBeInTheDocument()
  })

  it('shows error message when previewBulkImportAction returns error', async () => {
    vi.mocked(previewBulkImportAction).mockResolvedValue({ error: 'No rows found in CSV', rows: [] })
    render(<BulkImportForm />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: /preview/i }))
    await waitFor(() => expect(screen.getByText(/no rows found/i)).toBeInTheDocument())
  })

  it('shows preview table with rows after successful preview', async () => {
    vi.mocked(previewBulkImportAction).mockResolvedValue({
      rows: [
        { rowIndex: 0, name: 'Taiwan Tea', slug: 'taiwan-tea', status: 'new', validatedData: {} as never },
        { rowIndex: 1, name: 'Old Brand', slug: 'old-brand', status: 'potential-duplicate', match: { brandName: 'Old Brand Co', brandSlug: 'old-brand-co', score: 0.8, inputName: 'Old Brand' }, validatedData: {} as never },
      ],
    })
    render(<BulkImportForm />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'name,description\n...' } })
    fireEvent.click(screen.getByRole('button', { name: /preview/i }))
    await waitFor(() => {
      expect(screen.getByText('Taiwan Tea')).toBeInTheDocument()
      expect(screen.getByText('Old Brand')).toBeInTheDocument()
      // New rows pre-selected, duplicates deselected
      // checkboxes[0] is the "Select all rows" header checkbox
      const checkboxes = screen.getAllByRole('checkbox')
      expect(checkboxes[1]).toBeChecked()    // Taiwan Tea (new) — pre-selected
      expect(checkboxes[2]).not.toBeChecked() // Old Brand (duplicate) — deselected
    })
    expect(screen.getByRole('button', { name: /import selected/i })).toBeInTheDocument()
  })

  it('shows results table after import', async () => {
    vi.mocked(previewBulkImportAction).mockResolvedValue({
      rows: [{ rowIndex: 0, name: 'Taiwan Tea', slug: 'taiwan-tea', status: 'new', validatedData: {} as never }],
    })
    vi.mocked(executeBulkImportAction).mockResolvedValue({
      results: [{ name: 'Taiwan Tea', status: 'imported' }],
    })
    render(<BulkImportForm />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'name\nTaiwan Tea' } })
    fireEvent.click(screen.getByRole('button', { name: /preview/i }))
    await waitFor(() => screen.getByRole('button', { name: /import selected/i }))
    fireEvent.click(screen.getByRole('button', { name: /import selected/i }))
    await waitFor(() => expect(screen.getAllByText(/imported/i).length).toBeGreaterThan(0))
  })
})
