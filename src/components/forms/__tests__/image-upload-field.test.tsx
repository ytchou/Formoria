// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ImageUploadField } from '../image-upload-field'

describe('ImageUploadField', () => {
  it('renders a file input and upload label', () => {
    render(<ImageUploadField name="logo" label="Brand Logo" />)
    expect(screen.getByLabelText('Brand Logo')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /upload/i })).toBeInTheDocument()
  })

  it('shows a preview when an image is selected', async () => {
    render(<ImageUploadField name="logo" label="Brand Logo" />)
    const file = new File(['(binary)'], 'logo.png', { type: 'image/png' })
    const input = screen.getByLabelText('Brand Logo')
    await userEvent.upload(input, file)
    await waitFor(() => {
      expect(screen.getByAltText('Brand Logo preview')).toBeInTheDocument()
    })
  })

  it('shows an error for files exceeding 5MB', async () => {
    render(<ImageUploadField name="logo" label="Brand Logo" />)
    const bigFile = Object.defineProperty(
      new File([''], 'big.png', { type: 'image/png' }),
      'size',
      { value: 6 * 1024 * 1024 }
    )
    const input = screen.getByLabelText('Brand Logo')
    await userEvent.upload(input, bigFile)
    await waitFor(() => {
      expect(screen.getByText(/file too large/i)).toBeInTheDocument()
    })
  })

  it('shows existing image URL as preview when currentUrl is provided', () => {
    render(
      <ImageUploadField
        name="hero"
        label="Hero Image"
        currentUrl="https://example.com/hero.jpg"
      />
    )
    expect(screen.getByAltText('Hero Image preview')).toHaveAttribute(
      'src',
      expect.stringContaining('hero.jpg')
    )
  })

  it('clears the preview when the remove button is clicked', async () => {
    render(
      <ImageUploadField
        name="hero"
        label="Hero Image"
        currentUrl="https://example.com/hero.jpg"
      />
    )
    await userEvent.click(screen.getByRole('button', { name: /remove/i }))
    expect(screen.queryByAltText('Hero Image preview')).not.toBeInTheDocument()
  })
})
