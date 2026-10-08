import { withAuditScope } from '@/lib/audit/scope'
import { NextResponse } from 'next/server'
import { normalizePublicSearchQuery } from '@/lib/brands/normalize-public-search-query'
import { searchBrandsAutocomplete } from '@/lib/services/brands'

const CACHE_CONTROL = 'public, s-maxage=60, stale-while-revalidate=300'

export const GET = withAuditScope(async (request: Request) => {
  const { searchParams } = new URL(request.url)
  const query = normalizePublicSearchQuery(searchParams.get('q') ?? '')

  if (!query) {
    return NextResponse.json(
      {
        error:
          "Query parameter 'q' is required and must be 2-100 characters (1 for a CJK character)",
      },
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
