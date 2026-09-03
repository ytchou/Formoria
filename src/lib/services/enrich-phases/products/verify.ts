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

/** Inputs `verifyOrigin` needs. All three or none — the decision is a consensus. */
export type OriginInputs = {
  deterministic: DeterministicOriginAssessment
  llm: LlmOriginAssessment
  registry: RegistryOriginAssessment
}

type ProposalDeps = {
  brandUrl: string
  imagePool: unknown[]
  rankFn: (pool: unknown[], url: string) => unknown | null
  /** Pre-computed same-host result (avoids re-parsing URLs). */
  sameHostResult: VerifyResult
  /** Pre-computed reachability result (avoids re-fetching). */
  reachableResult: VerifyResult
  /**
   * Origin evidence for this proposal's page. Supplied by the graph's read and
   * registry steps. Absent means "not assessed", which is reported as such —
   * `origin: null` — and never as "not made in Taiwan".
   */
  origin?: OriginInputs
}

/**
 * `unverified` is the one that matters: it means NOTHING checked the image, not
 * that the image failed. An empty pool used to skip the check silently, so a
 * brand whose acquisition produced no images passed image verification for
 * every proposal (DEV-1644 F6).
 */
export type ImageVerificationStatus = 'verified' | 'unverified' | 'missing'

export type ProposalVerification = {
  ok: boolean
  repairable: boolean
  failures: string[]
  /** Soft signals: recorded on `productsVerification`, never a drop. */
  warnings: string[]
  imageStatus: ImageVerificationStatus
  /** `null` when no origin evidence was supplied for this page. */
  origin: { qualified: boolean; method: OriginQualificationMethod | null } | null
}

/**
 * Runs every verification check. `repairable` is true when only closed-set or
 * image checks failed — the URL checks passed.
 *
 * Origin is assessed but never fails a proposal: a product that is not made in
 * Taiwan is still a product Formoria may list, so the decision rides out on
 * `origin` for the caller to stamp onto the proposal (`madeInTaiwanConfirmed`).
 */
export function verifyProposal(
  proposal: ProposalInput,
  deps: ProposalDeps,
): ProposalVerification {
  const failures: string[] = []
  const warnings: string[] = []
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

  // 3. Image. An empty pool cannot fail the check — there is nothing to rank —
  // but it must not pass it either, so it is recorded as unverified.
  let imageStatus: ImageVerificationStatus
  if (deps.imagePool.length === 0) {
    imageStatus = 'unverified'
    warnings.push('image_unverified: no classified images in the pool')
  } else {
    const imageResult = verifyImage(
      { url: proposal.url },
      deps.imagePool,
      deps.rankFn,
    )
    if (imageResult.ok) {
      imageStatus = 'verified'
    } else {
      imageStatus = 'missing'
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

  // 5. Origin — assessed, recorded, never a drop reason.
  const origin = deps.origin ? verifyOrigin(deps.origin).decision : null

  const ok = failures.length === 0
  // Repairable when URL checks passed but closed-set or image failed
  const repairable = !ok && !urlChecksFailed

  return { ok, repairable, failures, warnings, imageStatus, origin }
}
