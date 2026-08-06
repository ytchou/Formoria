import { withAuditScope } from '@/lib/audit/scope'
import { NextResponse } from 'next/server'
import { searchBrandsAutocomplete } from '@/lib/services/brands'

const CACHE_CONTROL = 'public, s-maxage=60, stale-while-revalidate=300'

export const GET = withAuditScope(async (request: Request) => {
  const { searchParams } = new URL(request.url)
  const query = searchParams.get('q')?.trim() ?? ''

  if (
    query.length < 2 ||
    query.length > 100 ||
    /^[\s%_*?]+$/.test(query)
  ) {
    return NextResponse.json(
      { error: "Query parameter 'q' is required and must be 2-100 characters" },
      { status: 400 },
    )
  }

  const t0 = performance.now()

  try {
    const results = await searchBrandsAutocomplete(query)

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
})
