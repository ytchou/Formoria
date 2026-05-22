'use client'

import { useState, useCallback } from 'react'

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp']

type UploadStatus = 'idle' | 'uploading' | 'success' | 'error'

type UseImageUploadConfig = {
  bucket: string
  path: string
}

type UseImageUploadReturn = {
  status: UploadStatus
  url: string | null
  error: string | null
  upload: (file: File, filename: string) => Promise<void>
  reset: () => void
}

export function useImageUpload(config: UseImageUploadConfig): UseImageUploadReturn {
  const [status, setStatus] = useState<UploadStatus>('idle')
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const upload = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async (file: File, _filename: string) => {
      // Client-side pre-filter: validate file type and size before hitting server
      if (!ACCEPTED_TYPES.includes(file.type)) {
        setStatus('error')
        setError('Please upload an image file (JPEG, PNG, or WebP)')
        return
      }

      if (file.size > MAX_FILE_SIZE) {
        setStatus('error')
        setError('File size must be under 5MB')
        return
      }

      setStatus('uploading')
      setError(null)

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
          return
        }

        const data = (await response.json()) as { url: string }
        setUrl(data.url)
        setStatus('success')
      } catch (err) {
        setStatus('error')
        setError(err instanceof Error ? err.message : 'Upload failed')
      }
    },
    [config.bucket, config.path]
  )

  const reset = useCallback(() => {
    setStatus('idle')
    setUrl(null)
    setError(null)
  }, [])

  return { status, url, error, upload, reset }
}
