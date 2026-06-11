'use client'

import { useState, useCallback } from 'react'

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp']

type UploadStatus = 'idle' | 'uploading' | 'success' | 'error'

type UseImageUploadConfig = {
  bucket: string
  path: string
}

type UploadResponse = {
  url?: string
  key?: string
}

type UploadResult = {
  url: string | null
  key: string | null
}

type UseImageUploadReturn = {
  status: UploadStatus
  url: string | null
  key: string | null
  error: string | null
  upload: (file: File, filename: string) => Promise<UploadResult | null>
  reset: () => void
}

export function useImageUpload(config: UseImageUploadConfig): UseImageUploadReturn {
  const [status, setStatus] = useState<UploadStatus>('idle')
  const [url, setUrl] = useState<string | null>(null)
  const [key, setKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const upload = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async (file: File, _filename: string) => {
      // Client-side pre-filter: validate file type and size before hitting server
      if (!ACCEPTED_TYPES.includes(file.type)) {
        setStatus('error')
        setError('Please upload an image file (JPEG, PNG, or WebP)')
        setUrl(null)
        setKey(null)
        return null
      }

      if (file.size > MAX_FILE_SIZE) {
        setStatus('error')
        setError('File size must be under 5MB')
        setUrl(null)
        setKey(null)
        return null
      }

      setStatus('uploading')
      setError(null)
      setUrl(null)
      setKey(null)

      try {
        const formData = new FormData()
        formData.append('file', file)
        formData.append('path', config.path)
        formData.append('bucket', config.bucket)

        const response = await fetch('/api/upload', {
          method: 'POST',
          body: formData,
        })

        if (!response.ok) {
          const data = (await response.json()) as { error?: string }
          setStatus('error')
          setError(data.error ?? 'Upload failed')
          return null
        }

        const data = (await response.json()) as UploadResponse
        const nextUrl = data.url ?? null
        const nextKey = data.key ?? null
        setUrl(nextUrl)
        setKey(nextKey)
        setStatus('success')
        return { url: nextUrl, key: nextKey }
      } catch (err) {
        setStatus('error')
        setError(err instanceof Error ? err.message : 'Upload failed')
        setUrl(null)
        setKey(null)
        return null
      }
    },
    [config.bucket, config.path]
  )

  const reset = useCallback(() => {
    setStatus('idle')
    setUrl(null)
    setKey(null)
    setError(null)
  }, [])

  return { status, url, key, error, upload, reset }
}
