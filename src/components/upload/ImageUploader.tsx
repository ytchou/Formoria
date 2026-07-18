'use client'

import { useRef, useCallback, useEffect, useState } from 'react'
import { Upload, X, Loader2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useImageUpload } from './useImageUpload'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import type { ImageUploadMetadata } from './useImageUpload'

type ImageUploaderProps = {
  mode: 'single' | 'multi'
  bucket: string
  path: string
  value?: string | string[]
  onUpload: (url: string, metadata?: ImageUploadMetadata) => void
  onRemove?: (index: number) => void
  maxFiles?: number
  id?: string
  uploadEndpoint?: string
}

export function ImageUploader({
  mode,
  bucket,
  path,
  value,
  onUpload,
  onRemove,
  maxFiles = 6,
  id,
  uploadEndpoint,
}: ImageUploaderProps) {
  const t = useTranslations('forms.uploader')
  const inputRef = useRef<HTMLInputElement>(null)
  const { status, url, metadata, error, upload, reset } = useImageUpload({
    bucket,
    path,
    endpoint: uploadEndpoint,
  })
  const queueRef = useRef<File[]>([])
  const onUploadRef = useRef(onUpload)
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
    currentFilenameRef.current = next.name
    upload(next)
  }, [upload])

  useEffect(() => {
    onUploadRef.current = onUpload
  }, [onUpload])

  useEffect(() => {
    if (url) {
      onUploadRef.current(url, metadata ?? undefined)
      reset()
      processNext()
    }
  }, [url, metadata, reset, processNext])

  useEffect(() => {
    if (status === 'error' && processingQueue) {
      if (currentFilenameRef.current) {
        setFailedFiles((prev) => [...prev, currentFilenameRef.current!])
      }
      processNext()
    }
  }, [status, processingQueue, processNext])

  const enqueueFiles = useCallback(
    (files: File[]) => {
      const remaining =
        mode === 'multi'
          ? maxFiles - (Array.isArray(value) ? value.length : 0)
          : 1
      const capped = files.slice(0, Math.max(0, remaining))
      queueRef.current.push(...capped)
      if (!processingQueue) processNext()
    },
    [mode, maxFiles, value, processingQueue, processNext],
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const files = Array.from(e.dataTransfer.files).filter((f) =>
        f.type.startsWith('image/'),
      )
      if (files.length === 0) return
      enqueueFiles(files)
    },
    [enqueueFiles],
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
    [enqueueFiles],
  )

  const urls =
    mode === 'multi'
      ? Array.isArray(value)
        ? value
        : []
      : value && typeof value === 'string'
        ? [value]
        : []

  const showDropZone = mode === 'single' ? urls.length === 0 : urls.length < maxFiles

  return (
    <div className="space-y-3">
      {/* Existing previews */}
      {urls.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {urls.map((imgUrl, index) => (
            <div
              key={imgUrl}
              className={cn(
                'group relative',
                mode === 'single' && 'w-full max-w-md',
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imgUrl}
                alt={t('imageAlt', { n: index + 1 })}
                className={mode === 'single'
                  ? 'aspect-video w-full max-w-md rounded-lg object-cover'
                  : 'h-20 w-20 rounded-lg object-cover'}
              />
              {onRemove && (
                <Button
                  type="button"
                  variant="ghost"
                  shape="pill"
                  onClick={() => onRemove(index)}
                  aria-label={t('ariaRemove', { n: index + 1 })}
                  className="absolute -right-3 -top-3 h-12 w-12 p-0 text-background opacity-0 transition-opacity hover:bg-transparent group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <span className="flex size-6 items-center justify-center rounded-full bg-foreground shadow-sm">
                    <X className="size-3" />
                  </span>
                </Button>
              )}
              {mode === 'single' && (
                <Button
                  id={id ? `${id}-replace` : undefined}
                  type="button"
                  variant="secondary"
                  onClick={() => inputRef.current?.click()}
                  className="absolute bottom-3 left-3 bg-background/95 shadow-sm hover:bg-background"
                >
                  <Upload className="size-4" />
                  {t('replace')}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Drop zone */}
      {showDropZone && (
        <div
          id={id ? `${id}-dropzone` : undefined}
          role="button"
          aria-label={t('clickOrDrag')}
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
          <span className="type-card-description">
            {status === 'uploading'
              ? t('uploading')
              : mode === 'single' && urls.length > 0
                ? t('clickToReplace')
                : t('clickOrDrag')}
          </span>
        </div>
      )}

      {/* Hidden file input */}
      <input
        id={id}
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple={mode === 'multi'}
        className="hidden"
        onChange={handleFileSelect}
      />

      {/* Error message */}
      {error && (
        <p className="text-xs text-destructive" aria-live="polite">
          {error}
        </p>
      )}
      {failedFiles.length > 0 && (
        <p className="text-xs text-destructive" aria-live="polite">
          {t('uploadFailed', { files: failedFiles.join(', ') })}
        </p>
      )}
    </div>
  )
}
