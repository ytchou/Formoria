// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import zh from '../../../../messages/zh-TW.json'

// Mock server action
vi.mock('@/app/[locale]/brands/[slug]/actions', () => ({
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

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="zh-TW" messages={zh}>
      {ui}
    </NextIntlClientProvider>
  )
}

describe('ReportDialog', () => {
  it('renders trigger button with aria-label 檢舉', () => {
    renderWithIntl(<ReportDialog brandId="b1" brandSlug="test-brand" />)
    expect(screen.getByRole('button', { name: /檢舉/i })).toBeInTheDocument()
  })

  it('shows the 4 report reason options when dialog is open', async () => {
    const user = userEvent.setup()
    renderWithIntl(<ReportDialog brandId="b1" brandSlug="test-brand" />)
    await user.click(screen.getByRole('button', { name: /檢舉/i }))
    expect(screen.getByRole('button', { name: /非台灣製造/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /資訊有誤/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /連結失效/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /不當內容/i })).toBeInTheDocument()
  })

  it('shows success confirmation when state.success is true', async () => {
    const { useActionState } = await import('react')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useActionState).mockReturnValue([{ success: true }, vi.fn(), false] as any)
    renderWithIntl(<ReportDialog brandId="b1" brandSlug="test-brand" />)
    // Open dialog
    await userEvent.setup().click(screen.getByRole('button', { name: /檢舉/i }))
    expect(screen.getByText(/感謝你的回報/i)).toBeInTheDocument()
  })

  it('shows error banner when state.error is set', async () => {
    const { useActionState } = await import('react')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useActionState).mockReturnValue([{ error: '發生錯誤' }, vi.fn(), false] as any)
    renderWithIntl(<ReportDialog brandId="b1" brandSlug="test-brand" />)
    await userEvent.setup().click(screen.getByRole('button', { name: /檢舉/i }))
    expect(screen.getByText('發生錯誤')).toBeInTheDocument()
  })
})
