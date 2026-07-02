'use client'

import { useRef, useState, useCallback, useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useImageUpload } from '@/components/upload/useImageUpload'
import { Label } from '@/components/ui/label'

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB

type ImageUploadFieldProps = {
  name: string
  label: string
  brandId?: string
  uploadPath?: string
  currentUrl?: string | null
}

export function ImageUploadField({
  name,
  label,
  brandId,
  uploadPath,
  currentUrl,
}: ImageUploadFieldProps) {
  const t = useTranslations('forms.imageUpload')
  const inputId = `image-upload-${name}`
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [localPreview, setLocalPreview] = useState<string | null>(currentUrl ?? null)
  const [cleared, setCleared] = useState(false)
  const [sizeError, setSizeError] = useState<string | null>(null)
  // URL confirmed by the most-recent completed upload (guards against stale race)
  const [confirmedUrl, setConfirmedUrl] = useState<string | null>(null)
  // Monotonically-increasing counter; each file-select increments it
  const selectTokenRef = useRef(0)
  // Token that was active when the current upload started — needed for the effect guard
  const [pendingToken, setPendingToken] = useState(0)
  // Reactive mirror of selectTokenRef.current; updated whenever the ref advances so the
  // inline hiddenValue derivation can read it without touching a ref during render.
  const [latestToken, setLatestToken] = useState(0)

  const storagePath = uploadPath ?? (brandId ? `brands/${brandId}/${name}` : `brands/tmp/${name}`)
  const { status, url, error, upload } = useImageUpload({
    bucket: 'brand-images',
    path: storagePath,
  })

  // When the hook reports a successful upload, only commit the URL if its
  // select-token is still the latest one (stale-URL race guard).
  useEffect(() => {
    if (status === 'success' && url && pendingToken === selectTokenRef.current) {
      setConfirmedUrl(url)
    }
  }, [status, url, pendingToken])

  // Derive the hidden URL value: use url directly when upload just completed (eliminates
  // the one-render gap before the useEffect sets confirmedUrl); fall back to confirmedUrl,
  // then currentUrl.
  const immediateUrl =
    status === 'success' && url && pendingToken === latestToken ? url : confirmedUrl
  const hiddenValue = cleared ? '' : (immediateUrl ?? currentUrl ?? '')

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return

      setSizeError(null)

      if (file.size > MAX_FILE_SIZE) {
        setSizeError(t('fileTooLarge'))
        e.target.value = ''
        return
      }

      // Increment and capture a token for this specific selection; a slower earlier
      // upload that completes after a newer one will see pendingToken !== selectTokenRef.current
      // in the effect and discard its result.
      selectTokenRef.current += 1
      const token = selectTokenRef.current
      setPendingToken(token)
      setLatestToken(token)

      // Show local preview immediately; reset cleared flag
      const objectUrl = URL.createObjectURL(file)
      setLocalPreview(objectUrl)
      setCleared(false)

      // Pre-upload to Supabase Storage via the hook → /api/upload
      const filename = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.]/g, '_')}`
      upload(file, filename)

      // Reset file input so the same file can be selected again
      e.target.value = ''
    },
    [t, upload]
  )

  const handleRemove = useCallback(() => {
    setLocalPreview(null)
    setCleared(true)
    setSizeError(null)
    setConfirmedUrl(null)
    // Invalidate any in-flight upload by advancing the token
    selectTokenRef.current += 1
    setLatestToken(selectTokenRef.current)
  }, [])

  const displayError = sizeError ?? error

  return (
    <div className="space-y-2">
      <Label htmlFor={inputId}>{label}</Label>

      {/* Hidden URL input — submitted as the field value in FormData */}
      <input type="hidden" name={name} value={hiddenValue} />

      {/* File input — labeled for accessibility */}
      <input
        ref={fileInputRef}
        id={inputId}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        aria-label={label}
        className="sr-only"
        onChange={handleFileSelect}
      />

      <div className="space-y-3">
        {/* Preview */}
        {localPreview && (
          <div className="relative inline-block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={localPreview}
              alt={`${label} preview`}
              className="h-24 w-24 rounded-lg border border-border object-cover"
            />
            {status === 'uploading' && (
              <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-card/70">
                <Loader2 className="h-5 w-5 animate-spin text-cta" />
              </div>
            )}
          </div>
        )}

        {/* Controls */}
        <div className="flex min-h-[48px] items-center gap-3">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={status === 'uploading'}
            aria-label={localPreview ? t('ariaReplace') : t('ariaUpload')}
            className="inline-flex min-h-[48px] items-center rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            {status === 'uploading' ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin text-cta" />
                {t('uploading')}
              </>
            ) : localPreview ? (
              t('replace')
            ) : (
              t('upload')
            )}
          </button>

          {localPreview && (
            <button
              type="button"
              onClick={handleRemove}
              aria-label={t('ariaRemove')}
              className="inline-flex min-h-[48px] items-center rounded-lg px-4 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
            >
              {t('remove')}
            </button>
          )}
        </div>

        {/* Error */}
        {displayError && (
          <p className="text-xs text-destructive">{displayError}</p>
        )}
      </div>
    </div>
  )
}
