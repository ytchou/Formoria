/**
 * Events link checker — checks official_url and ticket_url on published events.
 */

import { stableFingerprint, type HealthFinding } from '@/lib/services/health-agent/contracts'
import { pagedRead } from '@/lib/services/health-agent/paged-read'
import { mapWithConcurrency } from '@/lib/services/_shared/concurrency'

import type { CheckUrlResult } from './check-url'
import type { LinkCheckClassResult, LinkCheckClient } from './types'
import { LINK_CHECK_CONCURRENCY, MAX_DEAD_LINKS_PER_FINDING } from './types'

// ---------------------------------------------------------------------------
// Row shape
// ---------------------------------------------------------------------------

type EventRow = {
  id: string
  slug: string
  official_url: string | null
  ticket_url: string | null
  status: string
}

// ---------------------------------------------------------------------------
// DI seam
// ---------------------------------------------------------------------------

export type CheckEventDeps = {
  supabase: LinkCheckClient
  checkUrl: (url: string) => Promise<CheckUrlResult>
  requireNonEmpty?: boolean
}

// ---------------------------------------------------------------------------
// Checker
// ---------------------------------------------------------------------------

type DeadLink = {
  eventId: string
  eventSlug: string
  field: 'official_url' | 'ticket_url'
  url: string
  statusCode: number | null
}

export async function checkEventLinks(
  deps: CheckEventDeps,
): Promise<LinkCheckClassResult> {
  let events: EventRow[]
  try {
    events = await pagedRead<EventRow>(
      deps.supabase as { from: (t: string) => ReturnType<LinkCheckClient['from']> },
      'events',
      {
        orderBy: [{ column: 'id' }],
        select: 'id, slug, official_url, ticket_url, status',
        filters: [{ column: 'status', value: 'published' }],
        requireNonEmpty: deps.requireNonEmpty,
      },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      checked: 0,
      dead: 0,
      blocked: 0,
      error: message,
      findings: [
        {
          source: 'links-weekly',
          fingerprint: stableFingerprint('links-weekly', 'zero-rows', 'events'),
          title: 'Events link checker read zero events',
          severity: 'high',
          evidence: { error: message },
          mergePolicy: 'human',
        },
      ],
    }
  }

  // Collect all (event, field, url) triples
  const tasks: Array<{
    event: EventRow
    field: 'official_url' | 'ticket_url'
    url: string
  }> = []
  for (const event of events) {
    if (event.official_url) {
      tasks.push({ event, field: 'official_url', url: event.official_url })
    }
    if (event.ticket_url) {
      tasks.push({ event, field: 'ticket_url', url: event.ticket_url })
    }
  }

  if (tasks.length === 0) {
    return { checked: 0, dead: 0, blocked: 0, findings: [] }
  }

  let dead = 0
  let blocked = 0
  const deadLinks: DeadLink[] = []

  await mapWithConcurrency(tasks, LINK_CHECK_CONCURRENCY, async (task) => {
    const result = await deps.checkUrl(task.url)
    if (result.status === 'blocked') {
      blocked += 1
    } else if (result.status === 'broken') {
      dead += 1
      deadLinks.push({
        eventId: task.event.id,
        eventSlug: task.event.slug,
        field: task.field,
        url: task.url,
        statusCode: result.statusCode,
      })
    }
  })

  const findings: HealthFinding[] = []
  if (deadLinks.length > 0) {
    findings.push({
      source: 'links-weekly',
      fingerprint: stableFingerprint('links-weekly', 'dead-event-links', 'batch'),
      title: `${deadLinks.length} dead event link(s) found`,
      severity: 'medium',
      evidence: {
        deadLinks: deadLinks.slice(0, MAX_DEAD_LINKS_PER_FINDING),
        total: deadLinks.length,
        blocked,
      },
      mergePolicy: 'human',
    })
  }

  return { checked: tasks.length, dead, blocked, findings }
}
