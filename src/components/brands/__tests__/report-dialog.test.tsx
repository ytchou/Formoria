// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import zh from '../../../../messages/zh-TW.json'

const dispatchReportAction = vi.hoisted(() => vi.fn())

// Mock server action
vi.mock('@/app/[locale]/brands/[slug]/actions', () => ({
  submitReportAction: vi.fn(),
}))

vi.mock('@/lib/auth/use-user', () => ({ useUser: vi.fn() }))

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/brands/test-brand',
}))

// useActionState returns [state, dispatch, isPending]
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  return {
    ...actual,
    useActionState: vi.fn((_action: unknown, initialState: unknown) => [
      initialState,
      dispatchReportAction,
      false,
    ]),
  }
})

import { ReportDialog } from '../report-dialog'
import { useUser } from '@/lib/auth/use-user'

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="zh-TW" messages={zh}>
      {ui}
    </NextIntlClientProvider>
  )
}

describe('ReportDialog', () => {
  beforeEach(() => {
    window.localStorage.clear()
    dispatchReportAction.mockClear()
    ;(useUser as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      user: { id: 'user-uuid-9' },
      loading: false,
    })
  })

  it('renders trigger button with aria-label 檢舉', () => {
    renderWithIntl(<ReportDialog brandId="b1" brandSlug="test-brand" />)
    expect(screen.getByRole('button', { name: /檢舉/i })).toBeInTheDocument()
  })

  it('shows general reports and both brand representative request options', async () => {
    const user = userEvent.setup()
    renderWithIntl(<ReportDialog brandId="b1" brandSlug="test-brand" />)
    await user.click(screen.getByRole('button', { name: /檢舉/i }))
    expect(screen.getByRole('group', { name: '選擇檢舉原因' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /非台灣製造/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /資訊有誤/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /連結失效/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /不當內容/i })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: '品牌方申訴' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /所有權爭議/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /要求移除品牌頁/i })).toBeInTheDocument()
    expect(screen.getByText('品牌所有權相關問題')).toBeInTheDocument()
    expect(screen.getByText('請求移除此品牌頁面')).toBeInTheDocument()
  })

  it('renders an optional field picker', async () => {
    const user = userEvent.setup()
    renderWithIntl(<ReportDialog brandId="b1" brandSlug="test-brand" />)

    await user.click(screen.getByRole('button', { name: /檢舉/i }))

    expect(screen.getByRole('combobox')).toHaveAttribute('name', 'reportedField')
  })

  it('includes reportedField in form submission', async () => {
    const user = userEvent.setup()
    renderWithIntl(<ReportDialog brandId="b1" brandSlug="test-brand" />)

    await user.click(screen.getByRole('button', { name: /檢舉/i }))
    await user.click(screen.getByRole('button', { name: /連結失效/i }))
    await user.selectOptions(screen.getByRole('combobox'), 'website')
    await user.click(screen.getByRole('button', { name: /送出檢舉/i }))

    await waitFor(() => expect(dispatchReportAction).toHaveBeenCalledOnce())
    const submittedFormData = dispatchReportAction.mock.calls[0]?.[0]
    expect(submittedFormData).toBeInstanceOf(FormData)
    expect(submittedFormData.get('reportedField')).toBe('website')
  })

  it('uses the wider dialog shell and counts supplemental notes', async () => {
    const user = userEvent.setup()
    renderWithIntl(<ReportDialog brandId="b1" brandSlug="test-brand" />)
    await user.click(screen.getByRole('button', { name: /檢舉/i }))

    expect(screen.getByRole('dialog')).toHaveClass('sm:max-w-lg')

    const notes = screen.getByRole('textbox', { name: /補充說明/i })
    expect(notes).toHaveAttribute('maxlength', '1000')
    expect(notes).toHaveAttribute('placeholder', '請提供更多資訊，以協助我們更快處理')
    expect(screen.getByText('0 / 1000')).toBeInTheDocument()

    await user.type(notes, 'abc')
    expect(screen.getByText('3 / 1000')).toBeInTheDocument()
  })

  it('allows exactly one report reason at a time', async () => {
    const user = userEvent.setup()
    renderWithIntl(<ReportDialog brandId="b1" brandSlug="test-brand" />)
    await user.click(screen.getByRole('button', { name: /檢舉/i }))

    const brokenLink = screen.getByRole('button', { name: /連結失效/i })
    const inappropriate = screen.getByRole('button', { name: /不當內容/i })
    await user.click(brokenLink)
    await user.click(inappropriate)

    expect(brokenLink).toHaveAttribute('aria-pressed', 'false')
    expect(inappropriate).toHaveAttribute('aria-pressed', 'true')
    expect(document.querySelector<HTMLInputElement>('input[name="reason"]')?.value)
      .toBe('inappropriate')
  })

  it('shows a sign-in prompt instead of submit when ownership dispute is selected signed-out', async () => {
    ;(useUser as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      user: null,
      loading: false,
    })
    const user = userEvent.setup()
    renderWithIntl(<ReportDialog brandId="b1" brandSlug="test-brand" />)

    await user.click(screen.getByRole('button', { name: /檢舉/i }))
    await user.click(screen.getByRole('button', { name: /所有權爭議/i }))

    expect(screen.getByRole('link', { name: '登入' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /送出檢舉/i })).not.toBeInTheDocument()
  })

  it('keeps the normal notes + submit flow for signed-in dispute reports', async () => {
    ;(useUser as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      user: { id: 'user-uuid-9' },
      loading: false,
    })
    const user = userEvent.setup()
    renderWithIntl(<ReportDialog brandId="b1" brandSlug="test-brand" />)

    await user.click(screen.getByRole('button', { name: /檢舉/i }))
    await user.click(screen.getByRole('button', { name: /所有權爭議/i }))

    expect(screen.getByRole('textbox', { name: /補充說明/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /送出檢舉/i })).toBeInTheDocument()
  })

  it('requires sign-in for removal requests', async () => {
    ;(useUser as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      user: null,
      loading: false,
    })
    const user = userEvent.setup()
    renderWithIntl(<ReportDialog brandId="b1" brandSlug="test-brand" />)

    await user.click(screen.getByRole('button', { name: /檢舉/i }))
    await user.click(screen.getByRole('button', { name: /要求移除品牌頁/i }))

    expect(screen.getByText('請登入以提出品牌頁移除要求')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '登入' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /送出檢舉/i })).not.toBeInTheDocument()
  })

  it('keeps other reasons anonymous — no sign-in prompt when signed out', async () => {
    ;(useUser as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      user: null,
      loading: false,
    })
    const user = userEvent.setup()
    renderWithIntl(<ReportDialog brandId="b1" brandSlug="test-brand" />)

    await user.click(screen.getByRole('button', { name: /檢舉/i }))
    await user.click(screen.getByRole('button', { name: /連結失效/i }))

    expect(screen.queryByText('請登入以提出所有權爭議')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /送出檢舉/i })).toBeInTheDocument()
  })

  it('tracks prior reports per reason instead of blocking every report for a brand', async () => {
    window.localStorage.setItem('report:test-brand:broken_link', '1')
    const user = userEvent.setup()
    renderWithIntl(<ReportDialog brandId="b1" brandSlug="test-brand" />)

    await user.click(screen.getByRole('button', { name: /檢舉/i }))
    await user.click(screen.getByRole('button', { name: /要求移除品牌頁/i }))
    expect(screen.queryByText('你已回報過此品牌')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /連結失效/i }))
    expect(await screen.findByText('你已回報過此品牌')).toBeInTheDocument()
  })

  it('shows success confirmation when state.success is true', async () => {
    const { useActionState } = await import('react')
    vi.mocked(useActionState).mockReturnValue(
      [{ success: true }, vi.fn(), false] as ReturnType<typeof useActionState>
    )
    renderWithIntl(<ReportDialog brandId="b1" brandSlug="test-brand" />)
    // Open dialog
    await userEvent.setup().click(screen.getByRole('button', { name: /檢舉/i }))
    expect(screen.getByText(/感謝你的回報/i)).toBeInTheDocument()
  })

  it('shows error banner when state.error is set', async () => {
    const { useActionState } = await import('react')
    vi.mocked(useActionState).mockReturnValue(
      [{ error: '發生錯誤' }, vi.fn(), false] as ReturnType<typeof useActionState>
    )
    renderWithIntl(<ReportDialog brandId="b1" brandSlug="test-brand" />)
    await userEvent.setup().click(screen.getByRole('button', { name: /檢舉/i }))
    expect(screen.getByText('發生錯誤')).toBeInTheDocument()
  })
})
