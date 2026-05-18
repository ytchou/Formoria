'use client'

import { useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { resizeImage } from './resize-image'

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

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
    async (file: File, filename: string) => {
      // Validate file type
      if (!ACCEPTED_TYPES.includes(file.type)) {
        setStatus('error')
        setError('Please upload an image file (JPEG, PNG, WebP, or GIF)')
        return
      }

      // Validate file size
      if (file.size > MAX_FILE_SIZE) {
        setStatus('error')
        setError('File size must be under 5MB')
        return
      }

      setStatus('uploading')
      setError(null)

      try {
        const blob = await resizeImage(file)
        const supabase = createClient()
        const filePath = `${config.path}/${filename}`

        const { error: uploadError } = await supabase.storage
          .from(config.bucket)
          .upload(filePath, blob, {
            contentType: 'image/webp',
            upsert: true,
          })

        if (uploadError) {
          setStatus('error')
          setError(uploadError.message)
          return
        }

        const {
          data: { publicUrl },
        } = supabase.storage.from(config.bucket).getPublicUrl(filePath)

        setUrl(publicUrl)
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
