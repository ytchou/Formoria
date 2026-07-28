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

    fireEvent.click(button)
    expect(mocks.push).toHaveBeenCalledWith('/auth/sign-in')
    expect(mocks.setVote).not.toHaveBeenCalled()
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
