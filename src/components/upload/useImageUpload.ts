'use client'

import { useState, useCallback } from 'react'

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB
const ACCEPTED_TYPE_PREFIX = 'image/'

type UploadStatus = 'idle' | 'uploading' | 'success' | 'error'

type UseImageUploadConfig = {
  bucket: string
  path: string
  acceptedTypes?: string[]
  uploadFields?: Record<string, string>
  invalidTypeMessage: string
  fileTooLargeMessage: string
  uploadFailedMessage: string
  endpoint?: string
}

export type ImageUploadMetadata = {
  url?: string
  key?: string
  [key: string]: unknown
}

type UploadResult = {
  url: string | null
  key: string | null
  metadata: ImageUploadMetadata
}

type UseImageUploadReturn = {
  status: UploadStatus
  url: string | null
  key: string | null
  metadata: ImageUploadMetadata | null
  error: string | null
  upload: (file: File) => Promise<UploadResult | null>
  reset: () => void
}

export function useImageUpload(config: UseImageUploadConfig): UseImageUploadReturn {
  const [status, setStatus] = useState<UploadStatus>('idle')
  const [url, setUrl] = useState<string | null>(null)
  const [key, setKey] = useState<string | null>(null)
  const [metadata, setMetadata] = useState<ImageUploadMetadata | null>(null)
  const [error, setError] = useState<string | null>(null)

  const upload = useCallback(
    async (file: File) => {
      // Client-side pre-filter: validate file type and size before hitting server
      const typeOk = config.acceptedTypes
        ? config.acceptedTypes.includes(file.type)
        : file.type.startsWith(ACCEPTED_TYPE_PREFIX)
      if (!typeOk) {
        setStatus('error')
        setError(config.invalidTypeMessage)
        setUrl(null)
        setKey(null)
        setMetadata(null)
        return null
      }

      if (file.size > MAX_FILE_SIZE) {
        setStatus('error')
        setError(config.fileTooLargeMessage)
        setUrl(null)
        setKey(null)
        setMetadata(null)
        return null
      }

      setStatus('uploading')
      setError(null)
      setUrl(null)
      setKey(null)
      setMetadata(null)

      try {
        const formData = new FormData()
        formData.append('file', file)
        formData.append('path', config.path)
        formData.append('bucket', config.bucket)
        Object.entries(config.uploadFields ?? {}).forEach(([key, value]) => {
          formData.append(key, value)
        })

        const response = await fetch(config.endpoint ?? '/api/upload', {
          method: 'POST',
          body: formData,
        })

        if (!response.ok) {
          // Surface the server's reason (rejected type, size cap, auth) instead of
          // a generic failure — otherwise the upload is undiagnosable from the UI.
          const serverMessage = await response
            .json()
            .then((body: { error?: unknown }) =>
              typeof body?.error === 'string' ? body.error : null,
            )
            .catch(() => null)
          setStatus('error')
          setError(serverMessage ?? config.uploadFailedMessage)
          return null
        }

        const data = (await response.json()) as ImageUploadMetadata
        const nextUrl = data.url ?? null
        const nextKey = data.key ?? null
        setUrl(nextUrl)
        setKey(nextKey)
        setMetadata(data)
        setStatus('success')
        return { url: nextUrl, key: nextKey, metadata: data }
      } catch {
        setStatus('error')
        setError(config.uploadFailedMessage)
        setUrl(null)
        setKey(null)
        setMetadata(null)
        return null
      }
    },
    [config.acceptedTypes, config.bucket, config.endpoint, config.fileTooLargeMessage, config.invalidTypeMessage, config.path, config.uploadFailedMessage, config.uploadFields]
  )

  const reset = useCallback(() => {
    setStatus('idle')
    setUrl(null)
    setKey(null)
    setMetadata(null)
    setError(null)
  }, [])

  return { status, url, key, metadata, error, upload, reset }
}
