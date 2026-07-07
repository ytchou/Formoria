'use client'

import { ImageUploader } from '@/components/upload/ImageUploader'
import { Label } from '@/components/ui/label'
import { RequiredLabel } from '@/components/forms/required-label'

type ImageUploadFieldProps = {
  name: string
  label: string
  description?: string
  brandId?: string
  uploadPath?: string
  value?: string
  onChange: (value: string) => void
  required?: boolean
  error?: string
}

export function ImageUploadField({
  name,
  label,
  description,
  brandId,
  uploadPath,
  value = '',
  onChange,
  required = false,
  error,
}: ImageUploadFieldProps) {
  const inputId = `image-upload-${name}`
  const storagePath =
    uploadPath ?? (brandId ? `brands/${brandId}/${name}` : `brands/tmp/${name}`)

  return (
    <div className="space-y-2" aria-invalid={Boolean(error)}>
      {label ? (
        required ? (
          <RequiredLabel htmlFor={inputId}>{label}</RequiredLabel>
        ) : (
          <Label htmlFor={inputId}>{label}</Label>
        )
      ) : null}
      {description ? (
        <p className="text-sm leading-6 text-muted-foreground">{description}</p>
      ) : null}
      <ImageUploader
        id={inputId}
        mode="single"
        bucket="brand-images"
        path={storagePath}
        value={value}
        onUpload={onChange}
        onRemove={() => onChange('')}
      />
      <input type="hidden" name={name} value={value} />
      {error ? (
        <p className="text-xs text-destructive" aria-live="polite">
          {error}
        </p>
      ) : null}
    </div>
  )
}
