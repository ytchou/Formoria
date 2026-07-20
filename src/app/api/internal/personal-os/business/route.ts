import { errorResponse, NO_STORE_HEADERS } from '@/lib/internal/api-response'
import { isPersonalOsRequestAuthorized } from '@/lib/internal/personal-os-auth'
import { getFormoriaBusinessSnapshot } from '@/lib/services/formoria-business'

export async function GET(request: Request): Promise<Response> {
  if (!isPersonalOsRequestAuthorized(request)) {
    return errorResponse('unauthorized', 'Unauthorized', 401)
  }

  try {
    return Response.json(await getFormoriaBusinessSnapshot(), { headers: NO_STORE_HEADERS })
  } catch {
    return errorResponse(
      'business_unavailable',
      'Formoria business data is unavailable.',
      503,
    )
  }
}
