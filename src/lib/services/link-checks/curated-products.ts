/**
 * Curated products link checker — checks `official_url` on visible
 * curated_products and writes `link_state` + `link_checked_at`.
 *
 * Ported from `scripts/enrichment/products/curated-products/check-links.ts`.
 * The script stays in place; it is removed in the follow-up PR.
 *
 * WRITE SCOPE: only `link_state` and `link_checked_at` are written. Every
 * other column is authored — name, rationale, official_url — and a health run
 * that touched one would silently overwrite editorial copy.
 *
 * READ SCOPE: only `visible = true` rows are read. A hidden product is
 * excluded because no public surface renders one.
 */

import { stableFingerprint, type HealthFinding } from '@/lib/services/health-agent/contracts'
import { pagedRead } from '@/lib/services/health-agent/paged-read'
import { mapWithConcurrency } from '@/lib/services/_shared/concurrency'

import type { CheckUrlResult } from './check-url'
import type { LinkCheckClassResult, LinkCheckClient, LinkCheckWriter } from './types'
import { LINK_CHECK_CONCURRENCY, MAX_DEAD_LINKS_PER_FINDING } from './types'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Blocked statuses: 402/403/429. A bot challenge is not a dead link —
 * the stored `link_state` is left untouched. Aligned with check-url.ts's
 * BLOCKED_STATUSES (405 is in check-url's RETRY_ON, not blocked).
 */
const BLOCKED_STATUSES = new Set([402, 403, 429])

// ---------------------------------------------------------------------------
// Row shape
// ---------------------------------------------------------------------------

type ProductRow = {
  id: string
  brand_id: string
  key: string
  visible: boolean
  official_url: string | null
  link_state: string
}

// ---------------------------------------------------------------------------
// DI seam
// ---------------------------------------------------------------------------

export type CheckCuratedProductDeps = {
  supabase: LinkCheckClient & LinkCheckWriter
  checkUrl: (url: string) => Promise<CheckUrlResult>
  requireNonEmpty?: boolean
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function linkStateFromResult(result: CheckUrlResult): string | null {
  if (result.statusCode !== null && BLOCKED_STATUSES.has(result.statusCode)) {
    // Blocked — leave the stored state alone
    return null
  }
  if (result.status === 'ok') return 'ok'
  if (result.status === 'broken') return 'broken'
  // Redirect detection: if the resolved URL differs substantially we'd mark
  // it as 'redirected', but checkUrl doesn't expose that distinction at the
  // status level. For now, 'ok' covers both 2xx and followed redirects.
  return 'ok'
}

// ---------------------------------------------------------------------------
// Checker
// ---------------------------------------------------------------------------

type DeadLink = {
  productId: string
  key: string
  brandId: string
  url: string
  statusCode: number | null
}

export async function checkCuratedProductLinks(
  deps: CheckCuratedProductDeps,
): Promise<LinkCheckClassResult> {
  let products: ProductRow[]
  try {
    products = await pagedRead<ProductRow>(
      deps.supabase as { from: (t: string) => ReturnType<LinkCheckClient['from']> },
      'curated_products',
      {
        orderBy: [{ column: 'id' }],
        select: 'id, brand_id, key, visible, official_url, link_state',
        filters: [{ column: 'visible', value: true }],
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
          fingerprint: stableFingerprint('links-weekly', 'zero-rows', 'curated-products'),
          title: 'Curated products link checker read zero products',
          severity: 'high',
          evidence: { error: message },
          mergePolicy: 'human',
        },
      ],
    }
  }

  // Only visible products with a URL
  const checkable = products.filter((p) => p.official_url !== null)

  if (checkable.length === 0) {
    return { checked: 0, dead: 0, blocked: 0, findings: [] }
  }

  let dead = 0
  let blocked = 0
  const deadLinks: DeadLink[] = []
  const now = new Date().toISOString()

  await mapWithConcurrency(
    checkable,
    LINK_CHECK_CONCURRENCY,
    async (product) => {
      const result = await deps.checkUrl(product.official_url!)
      const newState = linkStateFromResult(result)

      if (result.status === 'blocked' || newState === null) {
        blocked += 1
        // Do not write link_state for blocked probes
        return
      }

      // Write link_state and link_checked_at
      const { error } = await (deps.supabase as LinkCheckWriter)
        .from('curated_products')
        .update({
          link_state: newState,
          link_checked_at: now,
        })
        .eq('id', product.id)

      if (error) {
        console.warn(`[link-checks] Failed to update curated_products ${product.key}: ${error.message}`)
        // Continue checking other products
        return
      }

      if (result.status === 'broken') {
        dead += 1
        deadLinks.push({
          productId: product.id,
          key: product.key,
          brandId: product.brand_id,
          url: product.official_url!,
          statusCode: result.statusCode,
        })
      }
    },
  )

  const findings: HealthFinding[] = []
  if (deadLinks.length > 0) {
    findings.push({
      source: 'links-weekly',
      fingerprint: stableFingerprint(
        'links-weekly',
        'dead-product-links',
        'batch',
      ),
      title: `${deadLinks.length} dead curated product link(s) found`,
      severity: 'medium',
      evidence: {
        deadLinks: deadLinks.slice(0, MAX_DEAD_LINKS_PER_FINDING),
        total: deadLinks.length,
        blocked,
      },
      mergePolicy: 'human',
    })
  }

  return { checked: checkable.length, dead, blocked, findings }
}
