import { isPersonalOsRequestAuthorized } from '@/lib/internal/personal-os-auth'
import { refreshExecutiveHealth } from '@/lib/services/executive-health'

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' }

export async function POST(request: Request): Promise<Response> {
  if (!isPersonalOsRequestAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE_HEADERS })
  }

  try {
    return Response.json(await refreshExecutiveHealth(), { headers: NO_STORE_HEADERS })
  } catch {
    return Response.json(
      { error: 'System status unavailable' },
      { status: 503, headers: NO_STORE_HEADERS },
    )
  }
}
