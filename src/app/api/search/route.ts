import { NextResponse } from 'next/server'
import { searchBrandsAutocomplete } from '@/lib/services/brands'

const CACHE_CONTROL = 'public, s-maxage=60, stale-while-revalidate=300'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const query = searchParams.get('q')?.trim() ?? ''
  const limitParam = searchParams.get('limit')

  if (!query || query.length > 100) {
    return NextResponse.json(
      { error: "Query parameter 'q' is required and must be 1-100 characters" },
      { status: 400 },
    )
  }

  const parsedLimit = limitParam ? parseInt(limitParam, 10) || 5 : 5
  const limit = Math.min(Math.max(parsedLimit, 1), 10)

  const t0 = performance.now()

  try {
    const results = await searchBrandsAutocomplete(query, limit)

    return NextResponse.json(
      { results },
      {
        headers: {
          'Cache-Control': CACHE_CONTROL,
          'Server-Timing': `rpc;dur=${(performance.now() - t0).toFixed(1)}`,
        },
      },
    )
  } catch {
    return NextResponse.json(
      { error: 'search_unavailable' },
      {
        status: 503,
        headers: {
          'Cache-Control': 'no-store',
          'Server-Timing': `rpc;dur=${(performance.now() - t0).toFixed(1)}`,
        },
      },
    )
  }
}
