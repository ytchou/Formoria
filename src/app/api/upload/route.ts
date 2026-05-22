import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { processImage } from '@/lib/security/image-processor'

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
    const bucket = (formData.get('bucket') as string | null) ?? 'brand-assets'

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

    // Upload to Supabase Storage using service client (bypasses RLS)
    const filename = `${path}/${Date.now()}-${crypto.randomUUID()}.webp`
    const serviceSupabase = createServiceClient()

    const { error: uploadError } = await serviceSupabase.storage
      .from(bucket)
      .upload(filename, processed.buffer, {
        contentType: 'image/webp',
        upsert: false,
      })

    if (uploadError) {
      console.error('Storage upload error:', uploadError)
      return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
    }

    const {
      data: { publicUrl },
    } = serviceSupabase.storage.from(bucket).getPublicUrl(filename)

    return NextResponse.json({
      url: publicUrl,
      width: processed.width,
      height: processed.height,
    })
  } catch (error) {
    console.error('Upload API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
