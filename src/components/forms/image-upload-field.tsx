'use client'

import { ImageUploader } from '@/components/upload/ImageUploader'
import { FormField } from '@/components/forms/form-field'

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
    <FormField
      id={inputId}
      label={label}
      description={description}
      required={required}
      error={error}
    >
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
    </FormField>
  )
}
