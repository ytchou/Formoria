import { isPersonalOsRequestAuthorized } from '@/lib/internal/personal-os-auth'
import {
  deleteMarketingItem,
  updateMarketingItem,
  VALID_TYPES,
  VALID_STATUSES,
  VALID_PRIORITIES,
  VALID_MEDIA,
  VALID_LANGS,
} from '@/lib/services/marketing-calendar'

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' }

type EnumField = 'status' | 'priority' | 'media' | 'lang' | 'type'

const ENUM_VALIDATORS: Record<EnumField, Set<string>> = {
  status: new Set(VALID_STATUSES),
  priority: new Set(VALID_PRIORITIES),
  media: new Set(VALID_MEDIA),
  lang: new Set(VALID_LANGS),
  type: new Set(VALID_TYPES),
}

function validatePatch(body: Record<string, unknown>): string | null {
  if ('id' in body) return 'id is immutable'
  if ('createdAt' in body) return 'createdAt is immutable'
  if ('updatedAt' in body) return 'updatedAt is immutable'

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

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return Response.json(
      { error: 'Invalid JSON body' },
      { status: 400, headers: NO_STORE_HEADERS },
    )
  }

  const validationError = validatePatch(body)
  if (validationError) {
    return Response.json({ error: validationError }, { status: 400, headers: NO_STORE_HEADERS })
  }

  try {
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
