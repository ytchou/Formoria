// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import zh from '../../../../messages/zh-TW.json'

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
      vi.fn(),
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
    ;(useUser as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      user: { id: 'user-uuid-9' },
      loading: false,
    })
  })

  it('renders trigger button with aria-label 檢舉', () => {
    renderWithIntl(<ReportDialog brandId="b1" brandSlug="test-brand" />)
    expect(screen.getByRole('button', { name: /檢舉/i })).toBeInTheDocument()
  })

  it('shows the 5 report reason options when dialog is open', async () => {
    const user = userEvent.setup()
    renderWithIntl(<ReportDialog brandId="b1" brandSlug="test-brand" />)
    await user.click(screen.getByRole('button', { name: /檢舉/i }))
    expect(screen.getByRole('button', { name: /非台灣製造/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /資訊有誤/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /連結失效/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /不當內容/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /所有權爭議/i })).toBeInTheDocument()
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
