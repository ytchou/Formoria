import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { getPostHogClient } from '@/lib/posthog-server'
import { createClient } from '@/lib/supabase/server'
import { sanitizeErrorResponse } from '@/lib/errors'
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
import { getClientIp } from '@/lib/security/rate-limiter'

async function captureAssetUploaded(
  request: Request,
  userId: string | null,
  properties: Record<string, unknown>,
): Promise<void> {
  const posthog = getPostHogClient()
  posthog.capture({
    distinctId: userId ?? request.headers.get('x-posthog-distinct-id') ?? crypto.randomUUID(),
    event: 'asset_uploaded',
    properties,
  })
  await posthog.flush()
}

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
    const contentLength = Number(request.headers.get('content-length') ?? 0)
    if (contentLength > MAX_FILE_SIZE) {
      return NextResponse.json({ error: 'File size must be under 5MB' }, { status: 400 })
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

    const requiresAuth = bucket === PRIVATE_UPLOAD_BUCKET
    let userId: string | null = null

    if (requiresAuth) {
      const supabase = await createClient()
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser()

      if (authError || !user) {
        return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
      }
      userId = user.id
    }

    const rateKey = userId ?? `guest:${getClientIp(request)}`
    const rateResult = uploadRateLimiter.check(
      rateKey,
      UPLOAD_RATE_LIMIT_WINDOW_MS,
      UPLOAD_RATE_LIMIT_MAX_REQUESTS
    )
    if (!rateResult.allowed) {
      return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
    }

    if (bucket === PRIVATE_UPLOAD_BUCKET && !path.startsWith(`${userId}/`)) {
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

        await captureAssetUploaded(request, userId, {
          bucket,
          asset_type: 'document',
          size_bytes: buffer.length,
          authenticated: true,
        })
        return NextResponse.json({
          key: result.key,
        })
      } catch (err) {
        Sentry.captureException(err)
        return NextResponse.json(sanitizeErrorResponse(err), { status: 500 })
      }
    }

    if (!file.type.startsWith('image/')) {
      return NextResponse.json({ error: 'Please upload an image file' }, { status: 400 })
    }

    let processed
    try {
      processed = await processImage(buffer, getUploadImageProcessingConfig(bucket))
    } catch (err) {
      Sentry.captureException(err)
      return NextResponse.json(sanitizeErrorResponse(err), { status: 400 })
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

        await captureAssetUploaded(request, userId, {
          bucket,
          asset_type: 'image',
          size_bytes: buffer.length,
          width: processed.width,
          height: processed.height,
          authenticated: true,
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

      await captureAssetUploaded(request, userId, {
        bucket,
        asset_type: 'image',
        size_bytes: buffer.length,
        width: processed.width,
        height: processed.height,
        authenticated: false,
      })
      return NextResponse.json({
        url: result.url,
        width: processed.width,
        height: processed.height,
      })
    } catch (err) {
      Sentry.captureException(err)
      return NextResponse.json(sanitizeErrorResponse(err), { status: 500 })
    }
  } catch (error) {
    Sentry.captureException(error)
    return NextResponse.json(sanitizeErrorResponse(error), { status: 500 })
  }
}
