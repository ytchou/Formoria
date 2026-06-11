import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { processImage } from '@/lib/security/image-processor'
import { createInMemoryRateLimiter } from '@/lib/security/rate-limiter'
import {
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
