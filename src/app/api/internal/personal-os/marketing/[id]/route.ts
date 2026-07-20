import { isPersonalOsRequestAuthorized } from '@/lib/internal/personal-os-auth'
import { deleteMarketingItem, updateMarketingItem } from '@/lib/services/marketing-calendar'

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' }

const VALID_STATUS = new Set(['idea', 'brief', 'scheduled', 'producing', 'review', 'published', 'archived'])
const VALID_PRIORITY = new Set(['low', 'medium', 'high'])
const VALID_MEDIA = new Set(['text-only', 'carousel', 'video', 'both'])
const VALID_LANG = new Set(['zh', 'en'])
const VALID_TYPE = new Set(['idea', 'brand-highlight', 'event', 'milestone', 'trend', 'series'])

type EnumField = 'status' | 'priority' | 'media' | 'lang' | 'type'

const ENUM_VALIDATORS: Record<EnumField, Set<string>> = {
  status: VALID_STATUS,
  priority: VALID_PRIORITY,
  media: VALID_MEDIA,
  lang: VALID_LANG,
  type: VALID_TYPE,
}

function validatePatch(body: Record<string, unknown>): string | null {
  if ('id' in body) return 'id is immutable'

  for (const [field, allowed] of Object.entries(ENUM_VALIDATORS)) {
    const value = body[field]
    if (value !== undefined && (typeof value !== 'string' || !allowed.has(value))) {
      return `Invalid ${field}: ${String(value)}`
    }
  }

  return null
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (!isPersonalOsRequestAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE_HEADERS })
  }

  const { id } = await params

  try {
    const body = (await request.json()) as Record<string, unknown>

    const validationError = validatePatch(body)
    if (validationError) {
      return Response.json({ error: validationError }, { status: 400, headers: NO_STORE_HEADERS })
    }

    const item = await updateMarketingItem(id, body)

    if (!item) {
      return Response.json({ error: 'Not found' }, { status: 404, headers: NO_STORE_HEADERS })
    }

    return Response.json({ item }, { headers: NO_STORE_HEADERS })
  } catch {
    return Response.json(
      { error: 'Marketing item update unavailable' },
      { status: 503, headers: NO_STORE_HEADERS },
    )
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (!isPersonalOsRequestAuthorized(_request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE_HEADERS })
  }

  const { id } = await params

  try {
    const result = await deleteMarketingItem(id)

    if (!result.deleted) {
      return Response.json({ error: 'Not found' }, { status: 404, headers: NO_STORE_HEADERS })
    }

    return Response.json({ deleted: true }, { headers: NO_STORE_HEADERS })
  } catch {
    return Response.json(
      { error: 'Marketing item deletion unavailable' },
      { status: 503, headers: NO_STORE_HEADERS },
    )
  }
}
