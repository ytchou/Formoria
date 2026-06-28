'use client'

import { useRef, useCallback, useEffect, useState } from 'react'
import { Upload, X, Loader2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
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
  const t = useTranslations('forms.uploader')
  const inputRef = useRef<HTMLInputElement>(null)
  const { status, url, error, upload, reset } = useImageUpload({ bucket, path })
  const queueRef = useRef<Array<{ file: File; filename: string }>>([])
  const currentFilenameRef = useRef<string | null>(null)
  const [processingQueue, setProcessingQueue] = useState(false)
  const [failedFiles, setFailedFiles] = useState<string[]>([])

  const processNext = useCallback(() => {
    const next = queueRef.current.shift()
    if (!next) {
      setProcessingQueue(false)
      return
    }
    setProcessingQueue(true)
    currentFilenameRef.current = next.file.name
    upload(next.file, next.filename)
  }, [upload])

  useEffect(() => {
    if (url) {
      onUpload(url)
      reset()
      processNext()
    }
  }, [url, onUpload, reset, processNext])

  useEffect(() => {
    if (status === 'error' && processingQueue) {
      if (currentFilenameRef.current) {
        setFailedFiles(prev => [...prev, currentFilenameRef.current!])
      }
      processNext()
    }
  }, [status, processingQueue, processNext])

  const enqueueFiles = useCallback(
    (files: File[]) => {
      const remaining = mode === 'multi' ? maxFiles - (Array.isArray(value) ? value.length : 0) : 1
      const capped = files.slice(0, Math.max(0, remaining))
      capped.forEach((file, i) => {
        const filename = `${Date.now()}-${i}-${file.name.replace(/[^a-zA-Z0-9.]/g, '_')}.webp`
        queueRef.current.push({ file, filename })
      })
      if (!processingQueue) processNext()
    },
    [mode, maxFiles, value, processingQueue, processNext]
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'))
      if (files.length === 0) return
      enqueueFiles(files)
    },
    [enqueueFiles]
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
  }, [])

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? [])
      if (files.length === 0) return
      enqueueFiles(files)
      e.target.value = ''
    },
    [enqueueFiles]
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
                alt={t('imageAlt', { n: index + 1 })}
                className="h-20 w-20 rounded-lg object-cover"
              />
              {onRemove && (
                <button
                  type="button"
                  onClick={() => onRemove(index)}
                  aria-label={t('ariaRemove', { n: index + 1 })}
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
          className="flex min-h-[120px] cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border bg-muted p-6 transition-colors hover:border-cta"
        >
          {status === 'uploading' ? (
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          ) : (
            <Upload className="h-6 w-6 text-muted-foreground" />
          )}
          <span className="text-sm text-muted-foreground">
            {status === 'uploading'
              ? t('uploading')
              : t('clickOrDrag')}
          </span>
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple={mode === 'multi'}
        className="hidden"
        onChange={handleFileSelect}
      />

      {/* Error message */}
      {error && <p className="text-xs text-red-600">{error}</p>}
      {failedFiles.length > 0 && (
        <p className="text-xs text-red-600">{t('uploadFailed', { files: failedFiles.join(', ') })}</p>
      )}
    </div>
  )
}
