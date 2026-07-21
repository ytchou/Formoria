// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import zh from '../../../messages/zh-TW.json'

const mocks = vi.hoisted(() => ({
  trackGalleryPhotoView: vi.fn(),
  trackGalleryCompleted: vi.fn(),
}))
vi.mock('@/lib/analytics', () => ({
  trackGalleryPhotoView: mocks.trackGalleryPhotoView,
  trackGalleryCompleted: mocks.trackGalleryCompleted,
}))

vi.mock('next/image', () => ({
  default: ({ alt = '', fill, ...props }: Record<string, unknown>) => {
    void fill
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img alt={String(alt)} {...props} />
    )
  },
}))

import { ImageCarousel } from './image-carousel'

const imageUrl =
  'https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/test.jpg'

describe('ImageCarousel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('eagerly loads the visible hero image', () => {
    render(
      <NextIntlClientProvider locale="zh-TW" messages={zh}>
        <ImageCarousel images={[imageUrl]} alt="測試品牌" brandId="brand-uuid" brandSlug="test-brand" />
      </NextIntlClientProvider>,
    )

    expect(screen.getByRole('img')).not.toHaveAttribute('loading', 'lazy')
  })

  it('tracks gallery navigation with immutable ID, public slug, and photo index', async () => {
    const user = userEvent.setup()
    render(
      <NextIntlClientProvider locale="zh-TW" messages={zh}>
        <ImageCarousel
          images={[imageUrl, imageUrl.replace('test.jpg', 'test-2.jpg')]}
          alt="測試品牌"
          brandId="brand-uuid"
          brandSlug="test-brand"
        />
      </NextIntlClientProvider>,
    )

    await user.click(screen.getByRole('button', { name: '下一張' }))

    expect(mocks.trackGalleryPhotoView).toHaveBeenCalledWith('test-brand', 1, 'brand-uuid')
  })

  it('fires trackGalleryCompleted once when all images have been viewed', async () => {
    const user = userEvent.setup()
    render(
      <NextIntlClientProvider locale="zh-TW" messages={zh}>
        <ImageCarousel
          images={[imageUrl, imageUrl.replace('test.jpg', 'test-2.jpg')]}
          alt="測試品牌"
          brandId="brand-uuid"
          brandSlug="test-brand"
        />
      </NextIntlClientProvider>,
    )

    // image 0 is shown initially; navigating to image 1 completes the set
    await user.click(screen.getByRole('button', { name: '下一張' }))

    expect(mocks.trackGalleryCompleted).toHaveBeenCalledTimes(1)
    expect(mocks.trackGalleryCompleted).toHaveBeenCalledWith('brand-uuid', 'test-brand', 2)
  })
})
