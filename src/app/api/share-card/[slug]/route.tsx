export const runtime = 'nodejs'

import { ImageResponse } from 'next/og'
import { NextResponse } from 'next/server'
import { getBrandBySlug, findBrandByOldSlug } from '@/lib/services/brands'
import { getOgFonts, getOgMarkDataUri } from '@/lib/brand/og-fonts'
import { NotFoundError } from '@/lib/errors'
import { renderShareCard } from '@/lib/growth/share-card'

const CACHE_CONTROL =
  'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params
  const { searchParams } = new URL(request.url)
  const download = searchParams.get('download') === '1'

  let brand
  try {
    brand = await getBrandBySlug(slug)
  } catch (err) {
    if (err instanceof NotFoundError) {
      const newSlug = await findBrandByOldSlug(slug)
      if (newSlug) {
        return NextResponse.redirect(
          new URL(`/api/share-card/${newSlug}`, request.url),
          {
            status: 302,
            headers: { 'Cache-Control': 'no-store' },
          },
        )
      }
      return new Response(null, { status: 404 })
    }
    return new Response(null, { status: 500 })
  }

  if (brand.status !== 'approved') {
    return new Response(null, { status: 404 })
  }

  try {
    const [fonts, markDataUri] = await Promise.all([
      getOgFonts(),
      getOgMarkDataUri(),
    ])

    const headers: Record<string, string> = {
      'Cache-Control': CACHE_CONTROL,
    }
    if (download) {
      headers['Content-Disposition'] =
        `attachment; filename="formoria-${slug}.png"`
    }

    return new ImageResponse(renderShareCard(brand, markDataUri), {
      width: 1080,
      height: 1350,
      fonts,
      headers,
    })
  } catch {
    return new Response(null, { status: 500 })
  }
}
