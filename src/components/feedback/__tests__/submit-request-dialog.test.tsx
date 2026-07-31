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
  refresh: vi.fn(),
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

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}))

vi.mock('@/lib/auth/use-user', () => ({ useUser: mocks.useUser }))

import { SubmitRequestDialog } from '../submit-request-dialog'

const copy = messages.feedback.submit

const VALID_TITLE = 'Let owners schedule a launch date'
const VALID_BODY = 'Owners want to line the launch up with a campaign.'
const GUEST_EMAIL = 'guest@example.com'

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

// `FormField` appends an `aria-hidden` asterisk to a required field's label, so
// the accessible name is "<label> *" — substring matching keeps the lookups
// keyed on the copy without hard-coding that marker.
function fieldFor(label: string) {
  return screen.getByLabelText(label, { exact: false })
}

// Both fields are required now, so every happy-path case fills both.
async function fillValidRequest(user: ReturnType<typeof userEvent.setup>) {
  await user.type(fieldFor(copy.titleLabel), VALID_TITLE)
  await user.type(fieldFor(copy.detailsLabel), VALID_BODY)
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

  // The board is in cold start: a guest can post without an account, and is
  // offered a reply-to address instead of a sign-in wall.
  it('lets a signed-out visitor submit and offers a contact email', async () => {
    mocks.useUser.mockReturnValue({ user: null, loading: false })
    await openDialog()

    expect(
      screen.getByRole('button', { name: copy.idle }),
    ).toBeInTheDocument()
    expect(fieldFor(copy.contactEmailLabel)).toBeInTheDocument()
  })

  it('sends the guest email with a signed-out submit', async () => {
    mocks.useUser.mockReturnValue({ user: null, loading: false })
    const user = await openDialog()

    await fillValidRequest(user)
    await user.type(fieldFor(copy.contactEmailLabel), GUEST_EMAIL)
    await user.click(screen.getByRole('button', { name: copy.idle }))

    await waitFor(() =>
      expect(mocks.submit).toHaveBeenCalledWith(
        expect.objectContaining({ guestEmail: GUEST_EMAIL }),
      ),
    )
  })

  it('blocks a malformed guest email before the action is called', async () => {
    mocks.useUser.mockReturnValue({ user: null, loading: false })
    const user = await openDialog()

    await fillValidRequest(user)
    await user.type(fieldFor(copy.contactEmailLabel), 'not-an')
    await user.click(screen.getByRole('button', { name: copy.idle }))

    const field = fieldFor(copy.contactEmailLabel)
    await waitFor(() => expect(field).toHaveAttribute('aria-invalid', 'true'))
    const errorId = field.getAttribute('aria-describedby')?.split(' ').at(-1)
    expect(errorId).toBeTruthy()
    expect(document.getElementById(errorId!)).toHaveTextContent(
      copy.errors.contactEmail,
    )
    expect(mocks.submit).not.toHaveBeenCalled()
  })

  // A signed-in submitter's address is already on their account, so asking for
  // one again would be a second, unverified address.
  it('hides the contact email field when signed in', async () => {
    await openDialog()

    expect(screen.queryByLabelText(copy.contactEmailLabel)).toBeNull()
  })

  it('shows the anonymity disclosure', async () => {
    await openDialog()

    expect(screen.getByText(copy.anonymityDisclosure)).toBeInTheDocument()
  })

  it('associates the error with the field', async () => {
    const user = await openDialog()

    await user.type(fieldFor(copy.titleLabel), 'hi')
    await user.click(screen.getByRole('button', { name: copy.idle }))

    const field = fieldFor(copy.titleLabel)
    await waitFor(() => expect(field).toHaveAttribute('aria-invalid', 'true'))
    const errorId = field.getAttribute('aria-describedby')?.split(' ').at(-1)
    expect(errorId).toBeTruthy()
    expect(document.getElementById(errorId!)).toHaveTextContent(
      copy.errors.title,
    )
    expect(mocks.submit).not.toHaveBeenCalled()
  })

  // The details field carries the substance of a request, so a title-only
  // submit is rejected in the dialog rather than round-tripping to the action.
  it('associates the error with the details field', async () => {
    const user = await openDialog()

    await user.type(fieldFor(copy.titleLabel), VALID_TITLE)
    await user.type(fieldFor(copy.detailsLabel), 'too short')
    await user.click(screen.getByRole('button', { name: copy.idle }))

    const field = fieldFor(copy.detailsLabel)
    await waitFor(() => expect(field).toHaveAttribute('aria-invalid', 'true'))
    const errorId = field.getAttribute('aria-describedby')?.split(' ').at(-1)
    expect(errorId).toBeTruthy()
    expect(document.getElementById(errorId!)).toHaveTextContent(
      copy.errors.details,
    )
    expect(mocks.submit).not.toHaveBeenCalled()
  })

  it('refreshes the board after a successful submit', async () => {
    const user = await openDialog()

    await fillValidRequest(user)
    await user.click(screen.getByRole('button', { name: copy.idle }))

    await waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenCalledWith(copy.success),
    )
    // Without this the submitter is told the request is on the board and then
    // cannot see it until a manual reload.
    expect(mocks.refresh).toHaveBeenCalled()
  })

  it('maps action error codes to localized messages', async () => {
    mocks.submit.mockResolvedValue({ ok: false, error: 'rate_limited' })
    const user = await openDialog()

    await fillValidRequest(user)
    await user.click(screen.getByRole('button', { name: copy.idle }))

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(copy.errors.rate_limited),
    )
    expect(mocks.toastError).not.toHaveBeenCalledWith(copy.errors.unavailable)
    expect(mocks.trackSubmitted).not.toHaveBeenCalled()
  })
})
