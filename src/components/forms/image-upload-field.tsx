'use client'
import { useState, useRef, useId } from 'react'

type ImageUploadFieldProps = {
  name: string
  label: string
  currentUrl?: string | null
  onDelete?: () => void
  maxSizeBytes?: number
  accept?: string
}

export function ImageUploadField({
  name,
  label,
  currentUrl,
  onDelete,
  maxSizeBytes = 5 * 1024 * 1024,
  accept = 'image/*',
}: ImageUploadFieldProps) {
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const id = useId()

  const displayUrl = preview ?? currentUrl ?? null

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    if (file.size > maxSizeBytes) {
      setError('File too large. Maximum size is 5MB.')
      return
    }
    const reader = new FileReader()
    reader.onload = (ev) => {
      if (typeof ev.target?.result === 'string') {
        setPreview(ev.target.result)
      }
    }
    reader.readAsDataURL(file)
  }

  function handleDelete() {
    setPreview(null)
    setError(null)
    if (inputRef.current) inputRef.current.value = ''
    onDelete?.()
  }

  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-sm font-medium text-[#1A1918]">
        {label}
      </label>
      {displayUrl ? (
        <div className="relative inline-block">
          <img
            src={displayUrl}
            alt={`${label} preview`}
            className="h-32 w-32 rounded-lg object-cover border border-[#E5E4E1]"
          />
          <button
            type="button"
            onClick={handleDelete}
            className="absolute -top-2 -right-2 rounded-full bg-white border border-[#E5E4E1] p-1 text-xs text-[#D94F3D] hover:bg-[#F5F4F1]"
            aria-label="Remove"
          >
            ✕
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-[#E5E4E1] bg-[#F5F4F1] p-6 hover:border-[#8B5E3C]">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="text-sm font-medium text-[#8B5E3C] hover:underline"
            aria-label="Upload"
          >
            Upload
          </button>
          <p className="text-xs text-[#857E79]">
            PNG, JPG up to {Math.round(maxSizeBytes / 1024 / 1024)}MB
          </p>
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        id={id}
        name={name}
        accept={accept}
        onChange={handleChange}
        className="sr-only"
        aria-label={label}
      />
      {error && <p className="text-xs text-[#D94F3D]">{error}</p>}
    </div>
  )
}
