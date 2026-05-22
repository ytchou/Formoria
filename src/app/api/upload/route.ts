import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { processImage } from '@/lib/security/image-processor'
import {
  uploadProcessedImage,
  ALLOWED_UPLOAD_BUCKETS,
  type AllowedUploadBucket,
} from '@/lib/services/image-upload'

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

    // Parse form data
    const formData = await request.formData()
    const file = formData.get('file')
    const path = formData.get('path')
    const rawBucket = (formData.get('bucket') as string | null) ?? 'brand-assets'

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

    // Convert file to Buffer and process server-side
    const buffer = Buffer.from(await file.arrayBuffer())

    let processed
    try {
      processed = await processImage(buffer)
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Image processing failed' },
        { status: 400 }
      )
    }

    // Upload via service layer
    let result
    try {
      result = await uploadProcessedImage(processed, path, bucket)
    } catch (err) {
      console.error('Storage upload error:', err)
      return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
    }

    return NextResponse.json({
      url: result.url,
      width: result.width,
      height: result.height,
    })
  } catch (error) {
    console.error('Upload API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
