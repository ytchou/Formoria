/**
 * Phase-output persistence: records per-phase outputs in `curation_phase_outputs`
 * and provides typed carry structures that flow between phases without re-reading
 * the database.
 */

import type { Json } from '@/lib/supabase/database.types'
import type { EnrichmentTarget } from '../_shared/enrichment-target'
import type { EnrichPatch } from '../enrich-phases/types'
import type { NameCandidate } from '../name-arbiter'
import type { ScrapedImageSource } from '@/lib/types/scraper'
import type {
  CatalogDiscoveryResult,
} from '../enrich-phases/catalog-discovery'

// ---------------------------------------------------------------------------
// Row type — mirrors DB shape
// ---------------------------------------------------------------------------

export type PhaseOutputRow = {
  id: string
  job_id: string
  target_id: string
  target_type: string
  phase: string
  status: string
  output: Json | null
  persisted_at: string | null
  created_at: string
}

// ---------------------------------------------------------------------------
// Phase carry — discriminated by phase
// ---------------------------------------------------------------------------

type CatalogAttemptSummary = CatalogDiscoveryResult['attempts'][number]
type CatalogProductTriple = CatalogDiscoveryResult['triples'][number]
type CatalogZeroReason = CatalogDiscoveryResult['zeroReason']

export type AcquireCarry = {
  catalog: {
    triples: CatalogProductTriple[]
    attempts: CatalogAttemptSummary[]
    zeroReason?: CatalogZeroReason
    deadlineHit: boolean
  }
  acquisitionPageUrls: string[]
  priorityProductUrls: string[]
  officialNameCandidates: NameCandidate[]
  scrapedImageSources: ScrapedImageSource[]
}

export type DetectCarry = {
  brandName: string
  isBrand: boolean
  category: string
}

export type NamesCarry = {
  candidates: NameCandidate[]
  verdict: string
}

export type PhaseCarry = AcquireCarry | DetectCarry | NamesCarry

export type PhaseOutput = {
  patch: Partial<EnrichPatch>
  carry?: PhaseCarry
}

// ---------------------------------------------------------------------------
// Carry builder — acquire
// ---------------------------------------------------------------------------

/**
 * Build an `AcquireCarry` from the acquire phase result. Strips `evidence`
 * (a non-serializable Map) and retains only the carry-safe fields.
 */
export function toAcquireCarry(result: {
  catalogResult?: CatalogDiscoveryResult
  acquisitionPageUrls: string[]
  priorityProductUrls: string[]
  officialNameCandidates: NameCandidate[]
  scrapedImageSources: ScrapedImageSource[]
}): AcquireCarry {
  const cat = result.catalogResult
  return {
    catalog: {
      triples: cat?.triples ?? [],
      attempts: cat?.attempts ?? [],
      zeroReason: cat?.zeroReason,
      deadlineHit: cat?.deadlineHit ?? false,
    },
    acquisitionPageUrls: result.acquisitionPageUrls,
    priorityProductUrls: result.priorityProductUrls,
    officialNameCandidates: result.officialNameCandidates,
    scrapedImageSources: result.scrapedImageSources,
  }
}

// ---------------------------------------------------------------------------
// Carry size assertion
// ---------------------------------------------------------------------------

const CARRY_WARN_BYTES = 65_536 // 64 KB

/**
 * Warn (never truncate) when a carry exceeds 64 KB of serialized UTF-8.
 */
export function assertCarryBounded(
  carry: unknown,
  logger: { warn: (msg: string) => void },
): void {
  const bytes = Buffer.byteLength(JSON.stringify(carry), 'utf8')
  if (bytes > CARRY_WARN_BYTES) {
    logger.warn(
      `Phase carry exceeds ${CARRY_WARN_BYTES} bytes (${bytes} bytes). ` +
      'Review the carry shape — large carries slow upserts and bloat the table.',
    )
  }
}

// ---------------------------------------------------------------------------
// Injectable store interface
// ---------------------------------------------------------------------------

export type PhaseOutputStore = {
  reader: {
    /**
     * Return rows for the target ordered newest-first. The consumer filters
     * by status and picks the latest per phase.
     */
    latestPerPhase: (target: EnrichmentTarget) => Promise<PhaseOutputRow[]>
    /**
     * Return non-dry-run rows where `persisted_at` is null. The Supabase
     * implementation joins `curation_jobs!inner(dry_run)` filtered false.
     */
    unpersisted: (target: EnrichmentTarget) => Promise<PhaseOutputRow[]>
  }
  writer: {
    /** Upsert rows on the unique (job_id, target_id, target_type, phase) key. */
    upsert: (entries: PhaseOutputRow[]) => Promise<void>
    /** Set `persisted_at = now()` for the given ids. */
    markPersisted: (ids: string[]) => Promise<void>
  }
}

// ---------------------------------------------------------------------------
// Store operations (thin wrappers over the injectable store)
// ---------------------------------------------------------------------------

export type RecordPhaseOutputsInput = {
  jobId: string
  target: EnrichmentTarget
  entries: Array<{
    phase: string
    status: string
    output: PhaseOutput
  }>
}

/**
 * Upsert phase output rows for a target in a single job.
 */
export async function recordPhaseOutputs(
  store: PhaseOutputStore,
  input: RecordPhaseOutputsInput,
): Promise<void> {
  const rows: PhaseOutputRow[] = input.entries.map((entry) => ({
    id: '', // DB generates
    job_id: input.jobId,
    target_id: input.target.id,
    target_type: input.target.type,
    phase: entry.phase,
    status: entry.status,
    output: entry.output as unknown as Json,
    persisted_at: null,
    created_at: new Date().toISOString(),
  }))
  await store.writer.upsert(rows)
}

/**
 * Latest succeeded row per phase across all jobs for a target.
 */
export async function latestPhaseOutputs(
  store: PhaseOutputStore,
  target: EnrichmentTarget,
): Promise<Map<string, PhaseOutputRow>> {
  const rows = await store.reader.latestPerPhase(target)
  const result = new Map<string, PhaseOutputRow>()
  for (const row of rows) {
    if (row.status !== 'succeeded') continue
    // Rows come newest-first; first hit per phase wins.
    if (!result.has(row.phase)) {
      result.set(row.phase, row)
    }
  }
  return result
}

/**
 * Non-dry-run rows that have not been persisted yet.
 */
export async function listUnpersistedOutputs(
  store: PhaseOutputStore,
  target: EnrichmentTarget,
): Promise<PhaseOutputRow[]> {
  return store.reader.unpersisted(target)
}

/**
 * Stamp the given rows as persisted.
 */
export async function markPersisted(
  store: PhaseOutputStore,
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return
  await store.writer.markPersisted(ids)
}

// ---------------------------------------------------------------------------
// Default Supabase implementation
// ---------------------------------------------------------------------------

import { createServiceClient } from '@/lib/supabase/service'

export function createSupabasePhaseOutputStore(): PhaseOutputStore {
  return {
    reader: {
      latestPerPhase: async (target) => {
        const supabase = createServiceClient()
        const { data, error } = await supabase
          .from('curation_phase_outputs')
          .select('*')
          .eq('target_id', target.id)
          .eq('target_type', target.type)
          .order('created_at', { ascending: false })
        if (error) throw error
        return (data ?? []) as PhaseOutputRow[]
      },
      unpersisted: async (target) => {
        const supabase = createServiceClient()
        const { data, error } = await supabase
          .from('curation_phase_outputs')
          .select('*, curation_jobs!inner(dry_run)')
          .eq('target_id', target.id)
          .eq('target_type', target.type)
          .is('persisted_at', null)
          .eq('curation_jobs.dry_run', false)
        if (error) throw error
        return (data ?? []) as PhaseOutputRow[]
      },
    },
    writer: {
      upsert: async (entries) => {
        if (entries.length === 0) return
        const supabase = createServiceClient()
        const { error } = await supabase
          .from('curation_phase_outputs')
          .upsert(
            entries.map((e) => ({
              job_id: e.job_id,
              target_id: e.target_id,
              target_type: e.target_type,
              phase: e.phase,
              status: e.status,
              output: e.output,
            })),
            { onConflict: 'job_id,target_id,target_type,phase' },
          )
        if (error) throw error
      },
      markPersisted: async (ids) => {
        if (ids.length === 0) return
        const supabase = createServiceClient()
        const { error } = await supabase
          .from('curation_phase_outputs')
          .update({ persisted_at: new Date().toISOString() })
          .in('id', ids)
        if (error) throw error
      },
    },
  }
}
