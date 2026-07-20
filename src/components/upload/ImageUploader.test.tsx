// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render as rtlRender, screen, fireEvent } from '@testing-library/react'
import { type ReactElement } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import enMessages from '../../../messages/en.json'
import { ImageUploader } from './ImageUploader'

const render = (ui: ReactElement) =>
  rtlRender(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  )

vi.mock('./useImageUpload', () => ({
  useImageUpload: () => ({
    status: 'idle',
    url: null,
    error: null,
    upload: vi.fn(),
    reset: vi.fn(),
  }),
}))

describe('ImageUploader', () => {
  it('renders drop zone with prompt text in single mode', () => {
    render(
      <ImageUploader
        mode="single"
        bucket="brand-images"
        path="test"
        onUpload={vi.fn()}
      />
    )
    expect(
      screen.getByText(/click to upload or drag and drop/i)
    ).toBeInTheDocument()
  })

  it('renders drop zone in multi mode', () => {
    render(
      <ImageUploader
        mode="multi"
        bucket="brand-images"
        path="test"
        onUpload={vi.fn()}
      />
    )
    expect(
      screen.getByText(/click to upload or drag and drop/i)
    ).toBeInTheDocument()
  })

  it('shows existing image preview when value is provided', () => {
    render(
      <ImageUploader
        mode="single"
        bucket="brand-images"
        path="test"
        value="https://example.com/logo.webp"
        onUpload={vi.fn()}
      />
    )
    expect(screen.getByRole('img')).toHaveAttribute(
      'src',
      'https://example.com/logo.webp'
    )
    expect(screen.queryByText('Click or drag to replace')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Replace image' })).toBeInTheDocument()
  })

  it('shows multiple image previews in multi mode', () => {
    const urls = [
      'https://example.com/p1.webp',
      'https://example.com/p2.webp',
    ]
    render(
      <ImageUploader
        mode="multi"
        bucket="brand-images"
        path="test"
        value={urls}
        onUpload={vi.fn()}
        onRemove={vi.fn()}
      />
    )
    const images = screen.getAllByRole('img')
    expect(images).toHaveLength(2)
  })

  it('calls onRemove when remove button is clicked', () => {
    const onRemove = vi.fn()
    render(
      <ImageUploader
        mode="multi"
        bucket="brand-images"
        path="test"
        value={['https://example.com/p1.webp']}
        onUpload={vi.fn()}
        onRemove={onRemove}
      />
    )
    const removeButton = screen.getByLabelText(/remove/i)
    expect(removeButton).toHaveClass('h-12', 'w-12')
    expect(removeButton.querySelector('span')).toHaveClass('size-6')
    fireEvent.click(removeButton)
    expect(onRemove).toHaveBeenCalledWith(0)
  })

  it('has a file input that accepts images', () => {
    render(
      <ImageUploader
        mode="single"
        bucket="brand-images"
        path="test"
        id="hero-upload"
        onUpload={vi.fn()}
      />
    )
    const input = document.querySelector('input[type="file"]')
    expect(input).toHaveAttribute('id', 'hero-upload')
    expect(input).toHaveAttribute('accept', 'image/*')
    expect(screen.getByRole('button')).toHaveAttribute(
      'id',
      'hero-upload-dropzone',
    )
  })
})
