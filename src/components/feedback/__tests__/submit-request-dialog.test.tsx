// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import messages from '../../../../messages/en.json'

const mocks = vi.hoisted(() => ({
  submit: vi.fn(),
  trackSubmitted: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  useUser: vi.fn(),
}))

vi.mock('@/lib/actions/feature-requests', () => ({
  submitFeatureRequestAction: mocks.submit,
}))

vi.mock('@/lib/analytics', () => ({
  trackFeatureRequestSubmitted: mocks.trackSubmitted,
}))

vi.mock('sonner', () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}))

vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/feedback' }))

vi.mock('@/lib/auth/use-user', () => ({ useUser: mocks.useUser }))

import { SubmitRequestDialog } from '../submit-request-dialog'

const copy = messages.feedback.submit

function renderDialog() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SubmitRequestDialog />
    </NextIntlClientProvider>,
  )
}

async function openDialog() {
  const user = userEvent.setup()
  renderDialog()
  await user.click(screen.getByRole('button', { name: copy.trigger }))
  await screen.findByRole('dialog')
  return user
}

describe('SubmitRequestDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useUser.mockReturnValue({
      user: { id: 'f2b5b6ee-9a51-4a5f-8bb0-6dfd2b71a4c1' },
      loading: false,
    })
    mocks.submit.mockResolvedValue({ ok: true, id: 'request-id' })
  })

  it('renders a sign-in link instead of submit when signed out', async () => {
    mocks.useUser.mockReturnValue({ user: null, loading: false })
    await openDialog()

    const link = screen.getByRole('link', { name: copy.signInCta })
    expect(link).toHaveAttribute(
      'href',
      `/auth/sign-in?next=${encodeURIComponent('/feedback')}`,
    )
    expect(screen.queryByRole('button', { name: copy.idle })).toBeNull()
  })

  it('shows the anonymity disclosure', async () => {
    await openDialog()

    expect(screen.getByText(copy.anonymityDisclosure)).toBeInTheDocument()
  })

  it('associates the error with the field', async () => {
    const user = await openDialog()

    await user.type(screen.getByLabelText(copy.titleLabel), 'hi')
    await user.click(screen.getByRole('button', { name: copy.idle }))

    const field = screen.getByLabelText(copy.titleLabel)
    await waitFor(() => expect(field).toHaveAttribute('aria-invalid', 'true'))
    const errorId = field.getAttribute('aria-describedby')?.split(' ').at(-1)
    expect(errorId).toBeTruthy()
    expect(document.getElementById(errorId!)).toHaveTextContent(
      copy.errors.title,
    )
    expect(mocks.submit).not.toHaveBeenCalled()
  })

  it('maps action error codes to localized messages', async () => {
    mocks.submit.mockResolvedValue({ ok: false, error: 'rate_limited' })
    const user = await openDialog()

    await user.type(
      screen.getByLabelText(copy.titleLabel),
      'Let owners schedule a launch date',
    )
    await user.click(screen.getByRole('button', { name: copy.idle }))

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(copy.errors.rate_limited),
    )
    expect(mocks.toastError).not.toHaveBeenCalledWith(copy.errors.unavailable)
    expect(mocks.trackSubmitted).not.toHaveBeenCalled()
  })
})
