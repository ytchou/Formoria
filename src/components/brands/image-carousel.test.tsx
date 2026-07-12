// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import zh from '../../../messages/zh-TW.json'

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
  it('eagerly loads the visible hero image', () => {
    render(
      <NextIntlClientProvider locale="zh-TW" messages={zh}>
        <ImageCarousel images={[imageUrl]} alt="測試品牌" />
      </NextIntlClientProvider>,
    )

    expect(screen.getByRole('img')).not.toHaveAttribute('loading', 'lazy')
  })
})
