import { isPersonalOsRequestAuthorized } from '@/lib/internal/personal-os-auth'
import { getFormoriaExecutiveSnapshot } from '@/lib/services/formoria-executive'

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' }

export async function GET(request: Request): Promise<Response> {
  if (!isPersonalOsRequestAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE_HEADERS })
  }

  try {
    return Response.json(await getFormoriaExecutiveSnapshot(), { headers: NO_STORE_HEADERS })
  } catch {
    return Response.json(
      { error: 'Executive snapshot unavailable' },
      { status: 503, headers: NO_STORE_HEADERS },
    )
  }
}
