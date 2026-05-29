// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Mock server action
vi.mock('@/app/brands/[slug]/actions', () => ({
  submitReportAction: vi.fn(),
}))

// useActionState returns [state, dispatch, isPending]
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  return {
    ...actual,
    useActionState: vi.fn((_action: unknown, initialState: unknown) => [
      initialState,
      vi.fn(),
      false,
    ]),
  }
})

import { ReportDialog } from '../report-dialog'

describe('ReportDialog', () => {
  it('renders trigger button with aria-label 檢舉', () => {
    render(<ReportDialog brandId="b1" brandSlug="test-brand" />)
    expect(screen.getByRole('button', { name: /檢舉/i })).toBeInTheDocument()
  })

  it('shows the 4 report reason radio options when dialog is open', async () => {
    const user = userEvent.setup()
    render(<ReportDialog brandId="b1" brandSlug="test-brand" />)
    await user.click(screen.getByRole('button', { name: /檢舉/i }))
    expect(screen.getByLabelText(/非台灣製造/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/資訊有誤/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/連結失效/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/不當內容/i)).toBeInTheDocument()
  })

  it('shows success confirmation when state.success is true', async () => {
    const { useActionState } = await import('react')
    vi.mocked(useActionState).mockReturnValue([{ success: true }, vi.fn(), false] as any)
    render(<ReportDialog brandId="b1" brandSlug="test-brand" />)
    // Open dialog
    await userEvent.setup().click(screen.getByRole('button', { name: /檢舉/i }))
    expect(screen.getByText(/感謝你的回報/i)).toBeInTheDocument()
  })

  it('shows error banner when state.error is set', async () => {
    const { useActionState } = await import('react')
    vi.mocked(useActionState).mockReturnValue([{ error: '發生錯誤' }, vi.fn(), false] as any)
    render(<ReportDialog brandId="b1" brandSlug="test-brand" />)
    await userEvent.setup().click(screen.getByRole('button', { name: /檢舉/i }))
    expect(screen.getByText('發生錯誤')).toBeInTheDocument()
  })
})
