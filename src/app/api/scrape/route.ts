import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { sanitizeErrorResponse } from '@/lib/errors'
import { scrapeUrlSchema } from '@/lib/validations/submission'
import { scrapeBrandUrls } from '@/lib/services/scraper'
import { createClient } from '@/lib/supabase/server'
import { downloadAndStoreImages } from '@/lib/services/image-download'

const MAX_SCRAPED_IMAGES = 6

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const parsed = scrapeUrlSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
    }

    const { data, statuses } = await scrapeBrandUrls(parsed.data.urls)

    const externalUrls: string[] = []
    if (data.heroImageUrl) externalUrls.push(data.heroImageUrl)
    for (const url of data.galleryImageUrls) {
      if (!externalUrls.includes(url)) externalUrls.push(url)
    }
    const capped = externalUrls.slice(0, MAX_SCRAPED_IMAGES)

    if (capped.length > 0) {
      const folderId = `scraped-${crypto.randomUUID()}`
      const stored = await downloadAndStoreImages(capped, folderId)

      const heroStored = data.heroImageUrl ? stored[0] ?? null : null
      const galleryStart = data.heroImageUrl ? 1 : 0
      const galleryStored = stored.slice(galleryStart).filter(Boolean) as string[]

      data.heroImageUrl = heroStored
      data.galleryImageUrls = galleryStored
    }

    return NextResponse.json({ data, statuses })
  } catch (error) {
    Sentry.captureException(error)
    return NextResponse.json(
      sanitizeErrorResponse(error),
      { status: 500 }
    )
  }
}
