import { isPersonalOsRequestAuthorized } from '@/lib/internal/personal-os-auth'
import { getFormoriaExecutiveSnapshot } from '@/lib/services/formoria-executive'
import { errorResponse, NO_STORE_HEADERS } from '@/lib/internal/api-response'

export async function GET(request: Request): Promise<Response> {
  if (!isPersonalOsRequestAuthorized(request)) {
    return errorResponse('unauthorized', 'Unauthorized', 401)
  }

  try {
    return Response.json(await getFormoriaExecutiveSnapshot(), { headers: NO_STORE_HEADERS })
  } catch {
    return errorResponse(
      'business_unavailable',
      'Formoria executive data is unavailable.',
      503,
    )
  }
}
