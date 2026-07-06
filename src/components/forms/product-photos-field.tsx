'use client'

import { ImageUploader } from '@/components/upload/ImageUploader'
import { RequiredLabel } from '@/components/forms/required-label'

type ProductPhotosFieldProps = {
  value: string[]
  onChange: (value: string[]) => void
  label: string
  error?: string
}

export function ProductPhotosField({
  value,
  onChange,
  label,
  error,
}: ProductPhotosFieldProps) {
  return (
    <div className="space-y-2" aria-invalid={Boolean(error)}>
      <RequiredLabel htmlFor="productPhotos">{label}</RequiredLabel>
      <ImageUploader
        id="productPhotos-upload"
        mode="multi"
        bucket="brand-images"
        path="brands/tmp/productPhotos"
        value={value}
        maxFiles={6}
        onUpload={(url) => onChange([...value, url])}
        onRemove={(index) =>
          onChange(value.filter((_, itemIndex) => itemIndex !== index))
        }
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
