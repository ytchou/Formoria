import { withAuditScope } from '@/lib/audit/scope'
import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { getPostHogClient } from '@/lib/posthog-server'
import { ANALYTICS_EVENTS } from '@/lib/analytics/events'
import { createClient } from '@/lib/supabase/server'
import { sanitizeErrorResponse } from '@/lib/errors'
import { processImage } from '@/lib/security/image-processor'
import { createInMemoryRateLimiter } from '@/lib/security/rate-limiter'
import {
  uploadPublicImage,
  ALLOWED_UPLOAD_BUCKETS,
  type AllowedUploadBucket,
} from '@/lib/services/image-upload'
import { imagePathToUrl } from '@/lib/images/image-url'

async function captureAssetUploaded(
  request: Request,
  userId: string | null,
  properties: Record<string, unknown>,
): Promise<void> {
  const posthog = getPostHogClient()
  posthog.capture({
    distinctId: userId ?? request.headers.get('x-posthog-distinct-id') ?? crypto.randomUUID(),
    event: ANALYTICS_EVENTS.ASSET_UPLOADED,
    properties,
  })
  await posthog.flush()
}

const uploadRateLimiter = createInMemoryRateLimiter()
const UPLOAD_RATE_LIMIT_WINDOW_MS = 60_000
const UPLOAD_RATE_LIMIT_MAX_REQUESTS = 10
const MAX_FILE_SIZE = 5 * 1024 * 1024

export const POST = withAuditScope(async (request: Request) => {
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

    // Every bucket requires an authenticated user — the public brand-images
    // bucket has no anonymous upload path, and the in-memory rate limiter alone
    // is not an access control.
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }
    const userId = user.id

    const rateResult = uploadRateLimiter.check(
      userId,
      UPLOAD_RATE_LIMIT_WINDOW_MS,
      UPLOAD_RATE_LIMIT_MAX_REQUESTS
    )
    if (!rateResult.allowed) {
      return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
    }

    // Convert file to Buffer and process server-side
    const buffer = Buffer.from(await file.arrayBuffer())

    if (buffer.length > MAX_FILE_SIZE) {
      return NextResponse.json({ error: 'File size must be under 5MB' }, { status: 400 })
    }

    if (!file.type.startsWith('image/')) {
      return NextResponse.json({ error: 'Please upload an image file' }, { status: 400 })
    }

    let processed
    try {
      processed = await processImage(buffer)
    } catch (err) {
      Sentry.captureException(err)
      return NextResponse.json(sanitizeErrorResponse(err), { status: 400 })
    }

    // Upload via service layer
    const objectPath = `${path}/${Date.now()}-${crypto.randomUUID()}.webp`
    try {
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
        authenticated: true,
      })
      // The same-origin proxy path, not a storage URL (DEV-1551): the bucket
      // is private, and this value is written straight into an `<img src>` by
      // the dashboard uploader.
      return NextResponse.json({
        url: imagePathToUrl(result.path),
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
})
