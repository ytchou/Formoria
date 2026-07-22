// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import zh from '../../../../messages/zh-TW.json'

const dispatchEvidenceAction = vi.hoisted(() => vi.fn())

vi.mock('@/app/[locale]/brands/[slug]/actions', () => ({
  submitEvidenceAction: vi.fn(),
}))

vi.mock('@/lib/auth/use-user', () => ({ useUser: vi.fn() }))

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/brands/test-brand',
}))

vi.mock('@/components/upload/useImageUpload', () => ({
  useImageUpload: () => ({
    status: 'idle',
    url: null,
    key: null,
    metadata: null,
    error: null,
    upload: vi.fn(),
    reset: vi.fn(),
  }),
}))

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  return {
    ...actual,
    useActionState: vi.fn((_action: unknown, initialState: unknown) => [
      initialState,
      dispatchEvidenceAction,
      false,
    ]),
  }
})

import { EvidenceDialog } from '../evidence-dialog'
import { useUser } from '@/lib/auth/use-user'

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="zh-TW" messages={zh}>
      {ui}
    </NextIntlClientProvider>
  )
}

describe('EvidenceDialog', () => {
  beforeEach(() => {
    dispatchEvidenceAction.mockClear()
    ;(useUser as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      user: { id: 'user-uuid-9' },
      loading: false,
    })
  })

  it('gates anonymous users to sign-in', async () => {
    ;(useUser as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      user: null,
      loading: false,
    })
    const user = userEvent.setup()
    renderWithIntl(<EvidenceDialog brandId="b1" brandSlug="test-brand" />)

    await user.click(screen.getByRole('button', { name: /回報產地資訊/i }))

    expect(screen.getByRole('link', { name: /登入/i })).toBeInTheDocument()
    expect(screen.queryByLabelText(/產品名稱/i)).not.toBeInTheDocument()
  })

  it('requires a stance before submit', async () => {
    const user = userEvent.setup()
    renderWithIntl(<EvidenceDialog brandId="b1" brandSlug="test-brand" />)

    await user.click(screen.getByRole('button', { name: /回報產地資訊/i }))

    expect(screen.queryByRole('radio', { checked: true })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /送出/i })).toBeDisabled()
  })
})
