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
    like: 'Like',
    likeAriaLabel: 'Like this brand, {count, plural, one {# like} other {# likes}}',
    unlikeAriaLabel: 'Remove your like from this brand, {count, plural, one {# like} other {# likes}}',
    loading: 'Loading likes',
    rateLimited: 'Too many reactions. Please try again later.',
    error: "We couldn't update your like. Please try again.",
  },
}

function renderButton(variant: 'inline' | 'overlay' = 'inline') {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <LikeBrandButton
        brandId="d9428888-122b-4e1f-b85c-61c0a8904d6a"
        slug="molasses"
        variant={variant}
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
      name: 'Like this brand, 12 likes',
    })
    await waitFor(() => expect(button).toBeEnabled())

    fireEvent.click(button)

    expect(screen.getByRole('button', {
      name: 'Remove your like from this brand, 13 likes',
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
      name: 'Like this brand, 12 likes',
    })

    fireEvent.click(button)

    await waitFor(() => {
      expect(screen.getByRole('button', {
        name: 'Like this brand, 12 likes',
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
      name: 'Like this brand, 12 likes',
    })

    fireEvent.click(button)

    await waitFor(() => {
      expect(screen.getByRole('button', {
        name: 'Like this brand, 12 likes',
      })).toHaveAttribute('aria-pressed', 'false')
    })
    expect(mocks.toastError).toHaveBeenCalledWith(
      "We couldn't update your like. Please try again.",
    )
  })

  it('renders an icon-only overlay variant for image surfaces', async () => {
    renderButton('overlay')
    const button = await screen.findByRole('button', {
      name: 'Like this brand, 12 likes',
    })

    expect(button).toHaveAttribute('data-like-variant', 'overlay')
    expect(button).toHaveClass('size-12')
    expect(button).not.toHaveTextContent('12')
  })
})
