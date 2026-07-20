import { PostHogQueryError } from '@/lib/adapters/posthog/query-api'
import { errorResponse, NO_STORE_HEADERS } from '@/lib/internal/api-response'
import { isPersonalOsRequestAuthorized } from '@/lib/internal/personal-os-auth'
import { getPostHogAnalyticsSnapshot } from '@/lib/services/posthog-analytics'

const ERROR_MESSAGES = {
  posthog_unconfigured: 'PostHog analytics is not configured.',
  posthog_unavailable: 'PostHog analytics is temporarily unavailable.',
  invalid_provider_response: 'PostHog returned an invalid analytics response.',
} as const

export async function GET(request: Request): Promise<Response> {
  if (!isPersonalOsRequestAuthorized(request)) {
    return errorResponse('unauthorized', 'Unauthorized', 401)
  }

  try {
    return Response.json(await getPostHogAnalyticsSnapshot(), { headers: NO_STORE_HEADERS })
  } catch (error) {
    if (error instanceof PostHogQueryError) {
      return errorResponse(
        error.code,
        ERROR_MESSAGES[error.code],
        error.code === 'invalid_provider_response' ? 502 : 503,
      )
    }
    return errorResponse(
      'posthog_unavailable',
      ERROR_MESSAGES.posthog_unavailable,
      503,
    )
  }
}
