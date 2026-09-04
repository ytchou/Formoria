import { brandTarget } from '@/lib/services/_shared/enrichment-target'
import type { EnrichmentTarget } from '@/lib/services/_shared/enrichment-target'
import type { PersistedScrapeText } from '@/lib/services/enrich-phases/descriptions'
import type { DescriptionEvidence } from '@/lib/services/description-rewrite'
import type { DescriptionRewriteOutput } from '@/lib/services/description-rewrite'
import type { EnrichBrand } from '@/lib/services/enrich-phases/types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PairwiseBrand = {
  id: string
  name: string
  category: string | null
  slug: string
  description: string | null
}

type BlindMapping = { left: 'a' | 'b'; right: 'a' | 'b' }

type BlindResult<T> = {
  left: T
  right: T
  mapping: BlindMapping
}

type UnblindResult = {
  a: 'left' | 'right'
  b: 'left' | 'right'
}

export type PairwiseRunJson = {
  dataset: string
  mappings: Record<string, BlindMapping>
  traceIds: string[]
}

type PairwiseScore = { traceId: string; value: number }

export type PairwiseReportResult = {
  total: number
  pending: number
  ties: number
  aWins: number
  bWins: number
  aWinRate: number
  bWinRate: number
}

// ---------------------------------------------------------------------------
// Dependencies (injected, never imported directly)
// ---------------------------------------------------------------------------

export type BuildDescriptionTaskDeps = {
  loadPersistedScrapeText: (target: EnrichmentTarget) => Promise<PersistedScrapeText>
  buildDescriptionEvidence: (
    brand: EnrichBrand,
    pendingPatch: undefined,
    imageAlts: string[],
  ) => DescriptionEvidence
  rewriteBrandDescription: (
    brandName: string,
    existingDescription: string | null,
    snippets: string[],
    siteContent: string | null,
    audit: { jobId: undefined; target: undefined },
    evidence: DescriptionEvidence,
  ) => Promise<DescriptionRewriteOutput | null>
}

// ---------------------------------------------------------------------------
// stratifiedSample
// ---------------------------------------------------------------------------

export function stratifiedSample({
  brands,
  n,
  rng = Math.random,
}: {
  brands: PairwiseBrand[]
  n: number
  rng?: () => number
}): PairwiseBrand[] {
  if (brands.length <= n) return [...brands]

  // Group by category
  const groups = new Map<string, PairwiseBrand[]>()
  for (const brand of brands) {
    const cat = brand.category ?? '__none__'
    const list = groups.get(cat) ?? []
    list.push(brand)
    groups.set(cat, list)
  }

  // Allocate proportionally with floor of 1
  const allocations = new Map<string, number>()
  let allocated = 0

  // First pass: assign floor of 1 per category
  for (const cat of groups.keys()) {
    allocations.set(cat, 1)
    allocated += 1
  }

  // Remaining slots distributed proportionally
  const remaining = n - allocated
  if (remaining > 0) {
    const proportions: Array<{ cat: string; share: number }> = []
    for (const [cat, list] of groups) {
      proportions.push({ cat, share: list.length / brands.length })
    }

    // Sort by descending share for rounding fairness
    proportions.sort((a, b) => b.share - a.share)

    let distributedExtra = 0
    const extraAllocs: Array<{ cat: string; extra: number; frac: number }> = []
    for (const { cat, share } of proportions) {
      const rawExtra = share * remaining
      const floorExtra = Math.floor(rawExtra)
      extraAllocs.push({ cat, extra: floorExtra, frac: rawExtra - floorExtra })
      distributedExtra += floorExtra
    }

    // Distribute remainder by largest fractional part
    extraAllocs.sort((a, b) => b.frac - a.frac)
    let leftover = remaining - distributedExtra
    for (const alloc of extraAllocs) {
      if (leftover <= 0) break
      alloc.extra += 1
      leftover -= 1
    }

    for (const { cat, extra } of extraAllocs) {
      allocations.set(cat, (allocations.get(cat) ?? 0) + extra)
    }
  }

  // Cap each allocation to the actual group size
  for (const [cat, list] of groups) {
    const alloc = allocations.get(cat) ?? 0
    if (alloc > list.length) {
      allocations.set(cat, list.length)
    }
  }

  // Shuffle each group and take the allocated count
  const result: PairwiseBrand[] = []
  for (const [cat, list] of groups) {
    const count = allocations.get(cat) ?? 0
    // Fisher-Yates shuffle
    const shuffled = [...list]
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    result.push(...shuffled.slice(0, count))
  }

  return result.slice(0, n)
}

// ---------------------------------------------------------------------------
// blind / unblind
// ---------------------------------------------------------------------------

export function blind<T>(a: T, b: T, rng: () => number = Math.random): BlindResult<T> {
  if (rng() < 0.5) {
    return { left: a, right: b, mapping: { left: 'a', right: 'b' } }
  }
  return { left: b, right: a, mapping: { left: 'b', right: 'a' } }
}

export function unblind(mapping: BlindMapping): UnblindResult {
  return {
    a: mapping.left === 'a' ? 'left' : 'right',
    b: mapping.left === 'b' ? 'left' : 'right',
  }
}

// ---------------------------------------------------------------------------
// buildDescriptionTask
// ---------------------------------------------------------------------------

export async function buildDescriptionTask({
  brand,
  deps,
}: {
  brand: PairwiseBrand
  deps: BuildDescriptionTaskDeps
}): Promise<DescriptionRewriteOutput | null> {
  const target = brandTarget(brand.id)
  const scrapeText = await deps.loadPersistedScrapeText(target)
  const evidence = deps.buildDescriptionEvidence(
    brand as unknown as EnrichBrand,
    undefined,
    [],
  )

  return deps.rewriteBrandDescription(
    brand.name,
    brand.description,
    scrapeText.snippets,
    scrapeText.siteContent,
    { jobId: undefined, target: undefined },
    evidence,
  )
}

// ---------------------------------------------------------------------------
// pairwiseReport
// ---------------------------------------------------------------------------

export function pairwiseReport({
  runJson,
  scores,
}: {
  runJson: PairwiseRunJson
  scores: PairwiseScore[]
}): PairwiseReportResult {
  const scoreMap = new Map<string, number>()
  for (const s of scores) {
    scoreMap.set(s.traceId, s.value)
  }

  const total = runJson.traceIds.length
  let pending = 0
  let ties = 0
  let aWins = 0
  let bWins = 0

  for (const traceId of runJson.traceIds) {
    const score = scoreMap.get(traceId)
    if (score === undefined) {
      pending++
      continue
    }

    if (score === 0) {
      ties++
      continue
    }

    const mapping = runJson.mappings[traceId]
    if (!mapping) {
      pending++
      continue
    }

    // score > 0 means left wins, score < 0 means right wins
    const winningSide: 'left' | 'right' = score > 0 ? 'left' : 'right'
    const winningArm = mapping[winningSide]

    if (winningArm === 'a') {
      aWins++
    } else {
      bWins++
    }
  }

  const scored = total - pending
  return {
    total,
    pending,
    ties,
    aWins,
    bWins,
    aWinRate: scored > 0 ? aWins / scored : 0,
    bWinRate: scored > 0 ? bWins / scored : 0,
  }
}
