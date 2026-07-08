'use client'

import { useCallback } from 'react'
import { FormField } from '@/components/forms/form-field'
import { ImageUploader } from '@/components/upload/ImageUploader'

type ProductPhotosFieldProps = {
  value: string[]
  onChange: (value: string[]) => void
  label: string
  description?: string
  error?: string
}

export function ProductPhotosField({
  value,
  onChange,
  label,
  description,
  error,
}: ProductPhotosFieldProps) {
  const handleUpload = useCallback(
    (url: string) => onChange([...value, url]),
    [onChange, value],
  )
  const handleRemove = useCallback(
    (index: number) =>
      onChange(value.filter((_, itemIndex) => itemIndex !== index)),
    [onChange, value],
  )

  return (
    <FormField
      id="productPhotos"
      label={label}
      description={description}
      error={error}
      errorId="productPhotos-error"
      required
    >
      <ImageUploader
        id="productPhotos-upload"
        mode="multi"
        bucket="brand-images"
        path="brands/tmp/productPhotos"
        value={value}
        maxFiles={6}
        onUpload={handleUpload}
        onRemove={handleRemove}
      />
      <input
        id="productPhotos"
        name="productPhotos"
        type="hidden"
        value={JSON.stringify(value)}
      />
    </FormField>
  )
}
