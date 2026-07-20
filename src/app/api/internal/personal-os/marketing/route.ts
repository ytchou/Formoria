import { isPersonalOsRequestAuthorized } from '@/lib/internal/personal-os-auth'
import { listMarketingItems, createMarketingItem } from '@/lib/services/marketing-calendar'

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' }

const VALID_TYPES = ['idea', 'brand-highlight', 'event', 'milestone', 'trend', 'series'] as const
const VALID_STATUSES = [
  'idea',
  'brief',
  'scheduled',
  'producing',
  'review',
  'published',
  'archived',
] as const
const VALID_PRIORITIES = ['low', 'medium', 'high'] as const
const VALID_MEDIA = ['text-only', 'carousel', 'video', 'both'] as const
const VALID_LANGS = ['zh', 'en'] as const

export async function GET(request: Request): Promise<Response> {
  if (!isPersonalOsRequestAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE_HEADERS })
  }
  try {
    const items = await listMarketingItems()
    return Response.json({ items }, { headers: NO_STORE_HEADERS })
  } catch {
    return Response.json(
      { error: 'Marketing calendar unavailable' },
      { status: 503, headers: NO_STORE_HEADERS },
    )
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!isPersonalOsRequestAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE_HEADERS })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return Response.json(
      { error: 'Invalid JSON body' },
      { status: 400, headers: NO_STORE_HEADERS },
    )
  }

  if (!body.id || typeof body.id !== 'string') {
    return Response.json({ error: 'id is required' }, { status: 400, headers: NO_STORE_HEADERS })
  }
  if (!body.title || typeof body.title !== 'string') {
    return Response.json(
      { error: 'title is required' },
      { status: 400, headers: NO_STORE_HEADERS },
    )
  }
  if (!body.type || !(VALID_TYPES as readonly unknown[]).includes(body.type)) {
    return Response.json(
      { error: `type must be one of: ${VALID_TYPES.join(', ')}` },
      { status: 400, headers: NO_STORE_HEADERS },
    )
  }
  if (body.status !== undefined && !(VALID_STATUSES as readonly unknown[]).includes(body.status)) {
    return Response.json(
      { error: `status must be one of: ${VALID_STATUSES.join(', ')}` },
      { status: 400, headers: NO_STORE_HEADERS },
    )
  }
  if (
    body.priority !== undefined &&
    !(VALID_PRIORITIES as readonly unknown[]).includes(body.priority)
  ) {
    return Response.json(
      { error: `priority must be one of: ${VALID_PRIORITIES.join(', ')}` },
      { status: 400, headers: NO_STORE_HEADERS },
    )
  }
  if (body.media !== undefined && !(VALID_MEDIA as readonly unknown[]).includes(body.media)) {
    return Response.json(
      { error: `media must be one of: ${VALID_MEDIA.join(', ')}` },
      { status: 400, headers: NO_STORE_HEADERS },
    )
  }
  if (body.lang !== undefined && !(VALID_LANGS as readonly unknown[]).includes(body.lang)) {
    return Response.json(
      { error: `lang must be one of: ${VALID_LANGS.join(', ')}` },
      { status: 400, headers: NO_STORE_HEADERS },
    )
  }

  try {
    const item = await createMarketingItem(
      body as Parameters<typeof createMarketingItem>[0],
    )
    return Response.json({ item }, { headers: NO_STORE_HEADERS })
  } catch {
    return Response.json(
      { error: 'Marketing calendar unavailable' },
      { status: 503, headers: NO_STORE_HEADERS },
    )
  }
}
