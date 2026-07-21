import { errorResponse, NO_STORE_HEADERS } from '@/lib/internal/api-response'
import { isPersonalOsRequestAuthorized } from '@/lib/internal/personal-os-auth'
import { getFormoriaFeedbackSnapshot } from '@/lib/services/formoria-feedback'

export async function GET(request: Request): Promise<Response> {
  if (!isPersonalOsRequestAuthorized(request)) {
    return errorResponse('unauthorized', 'Unauthorized', 401)
  }

  try {
    return Response.json(await getFormoriaFeedbackSnapshot(), { headers: NO_STORE_HEADERS })
  } catch {
    return errorResponse('feedback_unavailable', 'Formoria feedback is unavailable.', 503)
  }
}
