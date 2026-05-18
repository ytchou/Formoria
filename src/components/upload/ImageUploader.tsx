'use client'

import { useRef, useCallback, useEffect } from 'react'
import { Upload, X, Loader2 } from 'lucide-react'
import { useImageUpload } from './useImageUpload'

type ImageUploaderProps = {
  mode: 'single' | 'multi'
  bucket: string
  path: string
  value?: string | string[]
  onUpload: (url: string) => void
  onRemove?: (index: number) => void
  maxFiles?: number
}

export function ImageUploader({
  mode,
  bucket,
  path,
  value,
  onUpload,
  onRemove,
  maxFiles = 6,
}: ImageUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const { status, url, error, upload, reset } = useImageUpload({ bucket, path })

  // When a new URL is available from the hook, notify the parent
  useEffect(() => {
    if (url) {
      onUpload(url)
      reset()
    }
  }, [url, onUpload, reset])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const file = e.dataTransfer.files[0]
      if (!file) return
      const filename = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.]/g, '_')}.webp`
      upload(file, filename)
    },
    [upload]
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
  }, [])

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return
      const filename = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.]/g, '_')}.webp`
      upload(file, filename)
      // Reset input so same file can be selected again
      e.target.value = ''
    },
    [upload]
  )

  const urls =
    mode === 'multi'
      ? Array.isArray(value)
        ? value
        : []
      : value && typeof value === 'string'
        ? [value]
        : []

  const showDropZone =
    mode === 'single' ? urls.length === 0 : urls.length < maxFiles

  return (
    <div className="space-y-3">
      {/* Existing previews */}
      {urls.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {urls.map((imgUrl, index) => (
            <div key={index} className="group relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imgUrl}
                alt={`Upload ${index + 1}`}
                className="h-20 w-20 rounded-lg object-cover"
              />
              {onRemove && (
                <button
                  type="button"
                  onClick={() => onRemove(index)}
                  aria-label={`Remove image ${index + 1}`}
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-neutral-800 text-white opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Drop zone */}
      {showDropZone && (
        <div
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click()
          }}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          className="flex min-h-[120px] cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-[#D4CFC9] bg-[#F5F4F1] p-6 transition-colors hover:border-[#E06B3F]"
        >
          {status === 'uploading' ? (
            <Loader2 className="h-6 w-6 animate-spin text-[#7C7570]" />
          ) : (
            <Upload className="h-6 w-6 text-[#7C7570]" />
          )}
          <span className="text-sm text-[#7C7570]">
            {status === 'uploading'
              ? 'Uploading...'
              : 'Click to upload or drag and drop'}
          </span>
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileSelect}
      />

      {/* Error message */}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}
