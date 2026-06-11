import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { processImage } from '@/lib/security/image-processor'
import { createInMemoryRateLimiter } from '@/lib/security/rate-limiter'
import {
  uploadPrivateFile,
  uploadPrivateImage,
  uploadPublicImage,
  ALLOWED_UPLOAD_BUCKETS,
  getUploadImageProcessingConfig,
  type AllowedUploadBucket,
} from '@/lib/services/image-upload'

const uploadRateLimiter = createInMemoryRateLimiter()
const UPLOAD_RATE_LIMIT_WINDOW_MS = 60_000
const UPLOAD_RATE_LIMIT_MAX_REQUESTS = 10
const PRIVATE_UPLOAD_BUCKET = 'claim-proofs'
const MAX_FILE_SIZE = 5 * 1024 * 1024
const PDF_MAGIC_BYTES = '%PDF'

function isPdf(buffer: Buffer): boolean {
  return buffer.subarray(0, PDF_MAGIC_BYTES.length).toString('utf8') === PDF_MAGIC_BYTES
}

export async function POST(request: Request) {
  try {
    // Auth check
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const rateResult = uploadRateLimiter.check(
      user.id,
      UPLOAD_RATE_LIMIT_WINDOW_MS,
      UPLOAD_RATE_LIMIT_MAX_REQUESTS
    )
    if (!rateResult.allowed) {
      return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
    }

    // Parse form data
    const formData = await request.formData()
    const file = formData.get('file')
    const path = formData.get('path')
    const rawBucket = (formData.get('bucket') as string | null) ?? 'brand-images'
    const proofType = formData.get('proofType')

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    if (!path || typeof path !== 'string') {
      return NextResponse.json({ error: 'No path provided' }, { status: 400 })
    }

    // Validate path — prevent path traversal
    if (path.includes('..') || path.startsWith('/')) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 })
    }

    // Validate bucket against allowlist
    if (!(ALLOWED_UPLOAD_BUCKETS as readonly string[]).includes(rawBucket)) {
      return NextResponse.json({ error: 'Invalid bucket' }, { status: 400 })
    }
    const bucket = rawBucket as AllowedUploadBucket

    if (bucket === PRIVATE_UPLOAD_BUCKET && !path.startsWith(`${user.id}/`)) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 403 })
    }

    // Convert file to Buffer and process server-side
    const buffer = Buffer.from(await file.arrayBuffer())

    if (buffer.length > MAX_FILE_SIZE) {
      return NextResponse.json({ error: 'File size must be under 5MB' }, { status: 400 })
    }

    if (file.type === 'application/pdf') {
      if (bucket !== PRIVATE_UPLOAD_BUCKET || proofType !== 'business_doc') {
        return NextResponse.json({ error: 'PDF uploads are only allowed for business documents' }, { status: 400 })
      }

      if (!isPdf(buffer)) {
        return NextResponse.json({ error: 'Invalid PDF file' }, { status: 400 })
      }

      const objectPath = `${path}/${Date.now()}-${crypto.randomUUID()}.pdf`
      try {
        const result = await uploadPrivateFile({
          bucket,
          path: objectPath,
          data: buffer,
          contentType: 'application/pdf',
        })

        return NextResponse.json({
          key: result.key,
        })
      } catch (err) {
        console.error('Storage upload error:', err)
        return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
      }
    }

    if (!file.type.startsWith('image/')) {
      return NextResponse.json({ error: 'Please upload an image file' }, { status: 400 })
    }

    let processed
    try {
      processed = await processImage(buffer, getUploadImageProcessingConfig(bucket))
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Image processing failed' },
        { status: 400 }
      )
    }

    // Upload via service layer
    const objectPath = `${path}/${Date.now()}-${crypto.randomUUID()}.webp`
    try {
      if (bucket === PRIVATE_UPLOAD_BUCKET) {
        const result = await uploadPrivateImage({
          bucket,
          path: objectPath,
          data: processed.buffer,
          contentType: 'image/webp',
        })

        return NextResponse.json({
          key: result.key,
          width: processed.width,
          height: processed.height,
        })
      }

      const result = await uploadPublicImage({
        bucket,
        path: objectPath,
        data: processed.buffer,
        contentType: 'image/webp',
      })

      return NextResponse.json({
        url: result.url,
        width: processed.width,
        height: processed.height,
      })
    } catch (err) {
      console.error('Storage upload error:', err)
      return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
    }
  } catch (error) {
    console.error('Upload API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
