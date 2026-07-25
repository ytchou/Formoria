// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { LikeBrandButton } from '../like-brand-button'

const mocks = vi.hoisted(() => ({
  getState: vi.fn(),
  setState: vi.fn(),
  trackLiked: vi.fn(),
  trackUnliked: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('@/lib/actions/brand-likes', () => ({
  getBrandLikeStateAction: mocks.getState,
  setBrandLikeAction: mocks.setState,
}))

vi.mock('@/lib/analytics', () => ({
  trackBrandLiked: mocks.trackLiked,
  trackBrandUnliked: mocks.trackUnliked,
}))

vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }))

const messages = {
  likeBrand: {
    like: 'Support',
    likeAriaLabel: 'Support this brand, {count, plural, one {# supporter} other {# supporters}}',
    unlikeAriaLabel: 'Remove your support from this brand, {count, plural, one {# supporter} other {# supporters}}',
    loading: 'Loading support count',
    rateLimited: 'Too many reactions. Please try again later.',
    error: "We couldn't update your support. Please try again.",
  },
}

function renderButton() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <LikeBrandButton
        brandId="d9428888-122b-4e1f-b85c-61c0a8904d6a"
        slug="molasses"
      />
    </NextIntlClientProvider>,
  )
}

describe('LikeBrandButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getState.mockResolvedValue({ ok: true, count: 12, liked: false })
    mocks.setState.mockResolvedValue({ ok: true, count: 13, liked: true })
  })

  it('loads the public count and applies a like with burst feedback', async () => {
    const { container } = renderButton()
    const button = await screen.findByRole('button', {
      name: 'Support this brand, 12 supporters',
    })
    await waitFor(() => expect(button).toBeEnabled())
    expect(button).toHaveTextContent('Support 12')

    fireEvent.click(button)

    expect(screen.getByRole('button', {
      name: 'Remove your support from this brand, 13 supporters',
    })).toHaveAttribute('aria-pressed', 'true')
    expect(container.querySelectorAll('[data-like-burst-particle]')).toHaveLength(6)
    expect(mocks.trackLiked).toHaveBeenCalledWith(
      'd9428888-122b-4e1f-b85c-61c0a8904d6a',
      'molasses',
    )
    await waitFor(() => expect(mocks.setState).toHaveBeenCalledWith(
      'd9428888-122b-4e1f-b85c-61c0a8904d6a',
      true,
    ))
  })

  it('rolls back an optimistic reaction when the server rejects it', async () => {
    mocks.setState.mockResolvedValue({ ok: false, error: 'rate_limited' })
    renderButton()
    const button = await screen.findByRole('button', {
      name: 'Support this brand, 12 supporters',
    })

    fireEvent.click(button)

    await waitFor(() => {
      expect(screen.getByRole('button', {
        name: 'Support this brand, 12 supporters',
      })).toHaveAttribute('aria-pressed', 'false')
    })
    expect(mocks.toastError).toHaveBeenCalledWith(
      'Too many reactions. Please try again later.',
    )
  })

  it('rolls back when the server action itself rejects', async () => {
    mocks.setState.mockRejectedValue(new Error('network failure'))
    renderButton()
    const button = await screen.findByRole('button', {
      name: 'Support this brand, 12 supporters',
    })

    fireEvent.click(button)

    await waitFor(() => {
      expect(screen.getByRole('button', {
        name: 'Support this brand, 12 supporters',
      })).toHaveAttribute('aria-pressed', 'false')
    })
    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith(
        "We couldn't update your support. Please try again.",
      )
    })
  })

  it('keeps a zero count visible as social proof', async () => {
    mocks.getState.mockResolvedValue({ ok: true, count: 0, liked: false })
    renderButton()
    const button = await screen.findByRole('button', {
      name: 'Support this brand, 0 supporters',
    })

    expect(button).toHaveTextContent('Support 0')
  })
})
