// @vitest-environment jsdom
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ImageUploadField } from '../image-upload-field'

vi.mock('@/components/upload/ImageUploader', () => ({
  ImageUploader: ({
    id,
    value,
    onUpload,
    onRemove,
  }: {
    id: string
    value: string
    onUpload: (url: string) => void
    onRemove: () => void
  }) => (
    <div id={id}>
      <span>{value || 'No image'}</span>
      <button type="button" onClick={() => onUpload('https://example.com/new.webp')}>
        Upload image
      </button>
      <button type="button" onClick={onRemove}>Remove image</button>
    </div>
  ),
}))

function ControlledField({ initialValue = '' }: { initialValue?: string }) {
  const [value, setValue] = useState(initialValue)
  return (
    <ImageUploadField
      name="heroImageUrl"
      label="Hero image"
      description="Used as the brand card cover."
      value={value}
      onChange={setValue}
      required
    />
  )
}

describe('ImageUploadField', () => {
  it('renders usage guidance', () => {
    render(<ControlledField />)
    expect(screen.getByText('Used as the brand card cover.')).toBeInTheDocument()
  })

  it('adapts the shared uploader to a controlled form value', async () => {
    const user = userEvent.setup()
    render(<ControlledField />)

    await user.click(screen.getByRole('button', { name: 'Upload image' }))

    expect(screen.getByText('https://example.com/new.webp')).toBeInTheDocument()
    expect(document.querySelector('input[name="heroImageUrl"]')).toHaveValue(
      'https://example.com/new.webp',
    )
  })

  it('clears the same controlled value when removed', async () => {
    const user = userEvent.setup()
    render(<ControlledField initialValue="https://example.com/hero.webp" />)

    await user.click(screen.getByRole('button', { name: 'Remove image' }))

    expect(screen.getByText('No image')).toBeInTheDocument()
    expect(document.querySelector('input[name="heroImageUrl"]')).toHaveValue('')
  })
})
