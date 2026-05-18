// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ImageUploader } from './ImageUploader'

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
        bucket="brand-assets"
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
        bucket="brand-assets"
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
        bucket="brand-assets"
        path="test"
        value="https://example.com/logo.webp"
        onUpload={vi.fn()}
      />
    )
    expect(screen.getByRole('img')).toHaveAttribute(
      'src',
      'https://example.com/logo.webp'
    )
  })

  it('shows multiple image previews in multi mode', () => {
    const urls = [
      'https://example.com/p1.webp',
      'https://example.com/p2.webp',
    ]
    render(
      <ImageUploader
        mode="multi"
        bucket="brand-assets"
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
        bucket="brand-assets"
        path="test"
        value={['https://example.com/p1.webp']}
        onUpload={vi.fn()}
        onRemove={onRemove}
      />
    )
    fireEvent.click(screen.getByLabelText(/remove/i))
    expect(onRemove).toHaveBeenCalledWith(0)
  })

  it('has a file input that accepts images', () => {
    render(
      <ImageUploader
        mode="single"
        bucket="brand-assets"
        path="test"
        onUpload={vi.fn()}
      />
    )
    const input = document.querySelector('input[type="file"]')
    expect(input).toHaveAttribute('accept', 'image/*')
  })
})
