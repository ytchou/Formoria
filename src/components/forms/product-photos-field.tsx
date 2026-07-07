'use client'

import { useCallback } from 'react'
import { ImageUploader } from '@/components/upload/ImageUploader'
import { RequiredLabel } from '@/components/forms/required-label'

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
    <div className="space-y-2" aria-invalid={Boolean(error)}>
      <RequiredLabel htmlFor="productPhotos">{label}</RequiredLabel>
      {description ? (
        <p className="text-sm leading-6 text-muted-foreground">{description}</p>
      ) : null}
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
      {error ? (
        <p
          id="productPhotos-error"
          className="text-xs text-destructive"
          aria-live="polite"
        >
          {error}
        </p>
      ) : null}
    </div>
  )
}
