import { withAuditScope } from '@/lib/audit/scope'
import { NextResponse } from 'next/server'
import { getHomepageWallCategory } from '@/lib/services/curated-products'
import { isVisibleCategory } from '@/lib/taxonomy/ontology'

// Matches the homepage's `revalidate = 3600`; the wall's seed rotates daily.
// Trade-off (DEV-1972): hidden-category tiles left the homepage's server HTML
// for this route, so they are reachable on click only (every product is still
// linked from /discover), and a category cached after midnight can sit beside
// an ISR "all" group composed the day before.
const CACHE_CONTROL = 'public, s-maxage=3600, stale-while-revalidate=86400'

export const GET = withAuditScope(async (request: Request) => {
  const { searchParams } = new URL(request.url)
  const category = searchParams.get('category') ?? ''

  if (!isVisibleCategory(category)) {
    return NextResponse.json(
      { error: "Query parameter 'category' must be a visible L1 category slug" },
      { status: 400 },
    )
  }

  const t0 = performance.now()

  try {
    const slots = await getHomepageWallCategory(category)

    return NextResponse.json(
      { slots },
      {
        headers: {
          'Cache-Control': CACHE_CONTROL,
          'Server-Timing': `rpc;dur=${(performance.now() - t0).toFixed(1)}`,
        },
      },
    )
  } catch {
    return NextResponse.json(
      { error: 'home_wall_unavailable' },
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
