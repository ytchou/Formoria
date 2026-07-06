// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { useForm } from 'react-hook-form'
import { describe, expect, it, vi } from 'vitest'
import messages from '@/../messages/en.json'
import type { BrandEditFormValues } from '@/lib/schemas/brand-edit'
import { MediaSection } from '../media-section'

vi.mock('@/components/forms/image-upload-field', () => ({
  ImageUploadField: ({ label }: { label: string }) => (
    <div data-testid="image-upload">{label}</div>
  ),
}))

vi.mock('@/components/forms/product-photos-field', () => ({
  ProductPhotosField: () => <div data-testid="product-photos">Product photos</div>,
}))

function Wrapper() {
  const form = useForm<BrandEditFormValues>()
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      <MediaSection form={form} />
    </NextIntlClientProvider>
  )
}

describe('MediaSection', () => {
  it('renders image upload', () => {
    render(<Wrapper />)
    expect(
      document.querySelector('[data-testid="image-upload"]') ||
        document.querySelector('input[type="file"]') ||
        screen.getByText(/image|photo|upload/i)
    ).toBeTruthy()
  })
})
