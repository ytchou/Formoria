/**
 * Pure verification functions for product proposals. Each function checks one
 * dimension; `verifyProposal` composes them and decides repairability.
 */

import {
  L1_CATEGORIES,
  subcategoryBySlug,
  materialBySlug,
} from '@/lib/taxonomy/ontology'
import {
  decideOriginQualification,
  type DeterministicOriginAssessment,
  type LlmOriginAssessment,
  type RegistryOriginAssessment,
  type OriginQualificationMethod,
} from '@/lib/services/curated-products/origin-qualification'

const L1_SLUGS = new Set<string>(L1_CATEGORIES.map((c) => c.slug))

type VerifyResult = { ok: boolean; reason?: string }

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

/** URL hostname match between product and brand. */
export function verifySameHost(productUrl: string, brandUrl: string): VerifyResult {
  try {
    const productHost = new URL(productUrl).hostname
    const brandHost = new URL(brandUrl).hostname
    if (productHost === brandHost) return { ok: true }
    return { ok: false, reason: `host mismatch: ${productHost} vs ${brandHost}` }
  } catch {
    return { ok: false, reason: 'invalid URL' }
  }
}

/** HEAD-or-GET reachability via injected fetch. */
export async function verifyReachable(
  url: string,
  fetchFn: typeof fetch,
): Promise<VerifyResult> {
  try {
    const res = await fetchFn(url, { method: 'HEAD', redirect: 'follow' })
    if (res.ok) return { ok: true }
    return { ok: false, reason: `HTTP ${res.status}` }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, reason: msg }
  }
}

/** Image pool contains a ranked match for this product URL. */
export function verifyImage(
  proposal: { url: string },
  pool: unknown[],
  rankFn: (pool: unknown[], url: string) => unknown | null,
): VerifyResult {
  const ranked = rankFn(pool, proposal.url)
  if (ranked != null) return { ok: true }
  return { ok: false, reason: 'no image found in pool' }
}

/** Delegates to the origin-qualification module. */
export function verifyOrigin(input: {
  deterministic: DeterministicOriginAssessment
  llm: LlmOriginAssessment
  registry: RegistryOriginAssessment
}): { ok: boolean; decision: { qualified: boolean; method: OriginQualificationMethod | null } } {
  const decision = decideOriginQualification(input)
  return { ok: decision.qualified, decision }
}

/** Category in L1, subcategory valid for that category, materials are known slugs. */
export function verifyClosedSets(proposal: {
  category?: string
  subcategory?: string
  material?: string[]
}): { ok: boolean; failures: string[] } {
  const failures: string[] = []

  if (proposal.category != null && !L1_SLUGS.has(proposal.category)) {
    failures.push(`unknown category: ${proposal.category}`)
  }

  if (proposal.subcategory != null) {
    const sub = subcategoryBySlug(proposal.subcategory)
    if (sub == null) {
      failures.push(`unknown subcategory: ${proposal.subcategory}`)
    } else if (proposal.category != null && sub.category !== proposal.category) {
      failures.push(
        `subcategory ${proposal.subcategory} belongs to ${sub.category}, not ${proposal.category}`,
      )
    }
  }

  if (proposal.material != null) {
    for (const slug of proposal.material) {
      if (materialBySlug(slug) == null) {
        failures.push(`unknown material: ${slug}`)
      }
    }
  }

  return { ok: failures.length === 0, failures }
}

// ---------------------------------------------------------------------------
// Composite
// ---------------------------------------------------------------------------

type ProposalInput = {
  url: string
  category?: string
  subcategory?: string
  material?: string[]
  imageUrl?: string | null
}

type ProposalDeps = {
  brandUrl: string
  imagePool: unknown[]
  rankFn: (pool: unknown[], url: string) => unknown | null
  /** Pre-computed same-host result (avoids re-parsing URLs). */
  sameHostResult: VerifyResult
  /** Pre-computed reachability result (avoids re-fetching). */
  reachableResult: VerifyResult
}

/**
 * Runs all five verification checks. `repairable` is true when only closed-set
 * or image checks failed — the URL checks passed.
 */
export function verifyProposal(
  proposal: ProposalInput,
  deps: ProposalDeps,
): { ok: boolean; repairable: boolean; failures: string[] } {
  const failures: string[] = []
  let urlChecksFailed = false

  // 1. Same host
  if (!deps.sameHostResult.ok) {
    failures.push(deps.sameHostResult.reason ?? 'host mismatch')
    urlChecksFailed = true
  }

  // 2. Reachable
  if (!deps.reachableResult.ok) {
    failures.push(deps.reachableResult.reason ?? 'unreachable')
    urlChecksFailed = true
  }

  // 3. Image — skip when the pool is empty (no images available to rank)
  if (deps.imagePool.length > 0) {
    const imageResult = verifyImage(
      { url: proposal.url },
      deps.imagePool,
      deps.rankFn,
    )
    if (!imageResult.ok) {
      failures.push(imageResult.reason ?? 'no image')
    }
  }

  // 4. Closed sets
  const closedSetResult = verifyClosedSets({
    category: proposal.category,
    subcategory: proposal.subcategory,
    material: proposal.material,
  })
  if (!closedSetResult.ok) {
    failures.push(...closedSetResult.failures)
  }

  const ok = failures.length === 0
  // Repairable when URL checks passed but closed-set or image failed
  const repairable = !ok && !urlChecksFailed

  return { ok, repairable, failures }
}
