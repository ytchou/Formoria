// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import messages from '../../../../messages/en.json'

const mocks = vi.hoisted(() => ({
  getMyVotedRequestIds: vi.fn(),
  setVote: vi.fn(),
  trackVoted: vi.fn(),
  toastError: vi.fn(),
  push: vi.fn(),
  useUser: vi.fn(),
}))

vi.mock('@/lib/actions/feature-requests', () => ({
  getMyVotedRequestIdsAction: mocks.getMyVotedRequestIds,
  setFeatureRequestVoteAction: mocks.setVote,
}))

vi.mock('@/lib/analytics', () => ({
  trackFeatureRequestVoted: mocks.trackVoted,
}))

vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }))

vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/feedback' }))

vi.mock('@/lib/auth/use-user', () => ({ useUser: mocks.useUser }))

import { FeatureRequestVotesProvider } from '@/hooks/use-feature-request-votes'
import { UpvoteButton } from '../upvote-button'

const REQUEST_ID = '6c1a6b0e-3d8b-4a3a-9a1b-2c4d5e6f7a80'
const REQUEST_TITLE = 'Let owners schedule a launch date'

function renderButton(ui: ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <FeatureRequestVotesProvider>{ui}</FeatureRequestVotesProvider>
    </NextIntlClientProvider>,
  )
}

function upvoteButton() {
  return renderButton(
    <UpvoteButton requestId={REQUEST_ID} title={REQUEST_TITLE} count={7} />,
  )
}

describe('UpvoteButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useUser.mockReturnValue({
      user: { id: 'a0b1c2d3-e4f5-4061-8273-849506172839' },
      loading: false,
    })
    mocks.getMyVotedRequestIds.mockResolvedValue({ ok: true, requestIds: [] })
    mocks.setVote.mockResolvedValue({ ok: true, count: 8, voted: true })
  })

  it('rolls back the count when the action fails', async () => {
    mocks.setVote.mockResolvedValue({ ok: false, error: 'rate_limited' })
    upvoteButton()
    const button = await screen.findByRole('button', {
      name: `Upvote ${REQUEST_TITLE}`,
    })
    await waitFor(() => expect(button).toBeEnabled())

    fireEvent.click(button)

    expect(button).toHaveTextContent('8')
    await waitFor(() => expect(button).toHaveTextContent('7'))
    expect(button).toHaveAttribute('aria-pressed', 'false')
    expect(mocks.toastError).toHaveBeenCalledWith(
      messages.feedback.upvote.rateLimited,
    )
    expect(mocks.trackVoted).not.toHaveBeenCalled()
  })

  it('renders the locked affordance when signed out', async () => {
    mocks.useUser.mockReturnValue({ user: null, loading: false })
    const { container } = upvoteButton()

    const button = await screen.findByRole('button', {
      name: `Sign in to upvote ${REQUEST_TITLE}`,
    })
    expect(button).toHaveTextContent('7')
    expect(
      container.querySelector('[data-auth-required-indicator]'),
    ).not.toBeNull()

    // `?next=` is what the email + password form forwards; the cookie alone
    // only covers the OAuth/email-link callback.
    fireEvent.click(button)
    expect(mocks.push).toHaveBeenCalledWith(
      `/en/auth/sign-in?next=${encodeURIComponent('/en/feedback')}`,
    )
    expect(document.cookie).toContain('post_auth_next')
    expect(mocks.setVote).not.toHaveBeenCalled()
    // Not a toggle when signed out: the click navigates.
    expect(button).not.toHaveAttribute('aria-pressed')
  })

  it('re-syncs the count when a fresher server value arrives', async () => {
    // Filter chips are soft navigations and rows are keyed by id, so the same
    // instance survives with a new `count` prop instead of remounting.
    const { rerender } = upvoteButton()
    const button = await screen.findByRole('button', {
      name: `Upvote ${REQUEST_TITLE}`,
    })
    expect(button).toHaveTextContent('7')

    rerender(
      <NextIntlClientProvider locale="en" messages={messages}>
        <FeatureRequestVotesProvider>
          <UpvoteButton
            requestId={REQUEST_ID}
            title={REQUEST_TITLE}
            count={12}
          />
        </FeatureRequestVotesProvider>
      </NextIntlClientProvider>,
    )

    expect(button).toHaveTextContent('12')
  })

  it('exposes pressed state', async () => {
    mocks.getMyVotedRequestIds.mockResolvedValue({
      ok: true,
      requestIds: [REQUEST_ID],
    })
    mocks.setVote.mockResolvedValue({ ok: true, count: 6, voted: false })
    upvoteButton()

    const button = await screen.findByRole('button', {
      name: `Remove your upvote from ${REQUEST_TITLE}`,
    })
    await waitFor(() => expect(button).toHaveAttribute('aria-pressed', 'true'))
    expect(button).toHaveAttribute('aria-busy', 'false')

    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-busy', 'true')

    await waitFor(() => expect(button).toHaveAttribute('aria-pressed', 'false'))
    await waitFor(() => expect(button).toHaveAttribute('aria-busy', 'false'))
    expect(mocks.trackVoted).toHaveBeenCalledWith(REQUEST_ID, false)
  })
})
