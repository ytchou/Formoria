import { revalidateTag } from 'next/cache'
import {
  ENRICH_PHASES,
  createEnrichmentSummary,
  runEnrich,
  type BrandOutcome,
  type OperationResult as CurationOperationResult,
} from '@/lib/services/curation-operations'
import {
  logEnrichmentProgress,
  type EnrichmentSummary,
} from '@/lib/services/enrichment-logger'
import {
  recoverStaleJobs,
  type CurationJob,
} from '@/lib/services/curation-jobs'
import { createServiceClient } from '@/lib/supabase/server'
import type { Json } from '@/lib/supabase/database.types'

type Supabase = ReturnType<typeof createServiceClient>
type OperationSupabase = Parameters<typeof runEnrich>[1]
type ValidOperation = 'enrich'
type EnrichPhase = (typeof ENRICH_PHASES)[number]
type EnrichTarget = 'brands' | 'submissions'
type CurationJobUpdate = Partial<
  Pick<CurationJob, 'status' | 'progress' | 'result' | 'started_at' | 'completed_at'>
>
type BrandStatus = 'approved' | 'hidden'

type JobParams = {
  slugs?: string[]
  submissionIds?: string[]
  target?: EnrichTarget
  stopAfter?: number
  phases?: EnrichPhase[]
  status?: BrandStatus
}
type ProgressJsonInput = {
  processed: number
  total: number
  skipped: number
  failed: number
}
type OperationResult = ProgressJsonInput & {
  changed: number
  changes: Array<Record<string, unknown>>
  errors: Array<{ slug: string; error: string }>
  brandOutcomes: BrandOutcome[]
}
type OperationWithSummary = CurationOperationResult & {
  enrichmentSummary: EnrichmentSummary
}
type CurationJobsMutation = PromiseLike<{ error: { message: string } | null }> & {
  eq: (column: string, value: string) => CurationJobsMutation
}
type CurationJobsTable = {
  update: (patch: CurationJobUpdate) => CurationJobsMutation
}
type CurationJobsFrom = (table: 'curation_jobs') => CurationJobsTable
type RevalidateTagOneArg = (tag: string) => void

export async function runJob(job: CurationJob): Promise<EnrichmentSummary> {
  const supabase = createServiceClient()
  await recoverStaleJobs()

  const startedAt = Date.now()
  let summary: EnrichmentSummary

  try {
    await updateJob(supabase, job.id, {
      status: 'running',
      started_at: new Date().toISOString(),
      progress: progressJson({ processed: 0, total: 0, skipped: 0, failed: 0 }),
    })

    const result = await runOperation(supabase, job)
    await updateJob(supabase, job.id, {
      status: 'completed',
      completed_at: new Date().toISOString(),
      progress: progressJson(normalizeOperationResult(result)),
      result: result.enrichmentSummary as unknown as Json,
    })
    summary = result.enrichmentSummary
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await updateJob(supabase, job.id, {
      status: 'failed',
      completed_at: new Date().toISOString(),
      result: {
        status: 'failed',
        error: message,
      } as Json,
    })
    summary = failedJobSummary(job, message, Date.now() - startedAt)
  }

  const revalidateTagOneArg = revalidateTag as RevalidateTagOneArg
  revalidateTagOneArg('quality-metrics')
  return summary
}

export function mergeSummaries(summaries: EnrichmentSummary[]): EnrichmentSummary {
  return summaries.reduce<EnrichmentSummary>(
    (merged, summary) => ({
      success: merged.success + summary.success,
      skipped: merged.skipped + summary.skipped,
      failed: merged.failed + summary.failed,
      failedBrands: [...merged.failedBrands, ...summary.failedBrands],
      durationMs: merged.durationMs + summary.durationMs,
    }),
    { success: 0, skipped: 0, failed: 0, failedBrands: [], durationMs: 0 }
  )
}

async function runOperation(supabase: Supabase, job: CurationJob): Promise<OperationWithSummary> {
  const operation = parseOperation(job.operation)
  const params = parseParams(job.params)
  const config = {
    dryRun: job.dry_run,
    slugs: params.slugs,
    limit: params.stopAfter,
    onProgress: logEnrichmentProgress,
  }
  let result: OperationWithSummary
  const status = params.status

  switch (operation) {
    case 'enrich':
      if (params.submissionIds && params.submissionIds.length > 0) {
        result = await runSubmissionEnrichment(supabase, params, config)
        break
      }

      result = await runEnrich(
        {
          ...config,
          target: params.target ?? (params.slugs?.length ? 'brands' : 'submissions'),
          status,
          phases: params.phases ?? [...ENRICH_PHASES],
          jobId: job.id,
        },
        operationSupabase(supabase)
      )
      break
    default:
      throw new Error(`Unhandled operation: ${operation}`)
  }

  return result
}

function parseOperation(operation: string): ValidOperation {
  if (operation === 'enrich') {
    return operation
  }

  if (
    [
      'clean-names',
      'normalize-slugs',
      'detect-non-brands',
      'enrich-descriptions',
      'enrich-links',
      'enrich-images',
      'score-and-scrape',
      'set-visibility',
    ].includes(operation)
  ) {
    console.warn(`[admin:run-job] Deprecated operation requested: ${operation}`)
    throw new Error('Operation removed — use enrich instead')
  }

  throw new Error(`Unsupported operation: ${operation}`)
}

function parseParams(params: Json | null): JobParams {
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    return {}
  }

  const raw = params as Record<string, unknown>
  const slugs = Array.isArray(raw.slugs)
    ? raw.slugs.filter((slug): slug is string => typeof slug === 'string' && slug.trim() !== '')
    : undefined
  const submissionIds = Array.isArray(raw.submissionIds)
    ? raw.submissionIds.filter((id): id is string => typeof id === 'string' && id.trim() !== '')
    : undefined
  const target = parseTarget(raw.target)
  const stopAfter =
    typeof raw.stopAfter === 'number' && Number.isFinite(raw.stopAfter) && raw.stopAfter > 0
      ? Math.floor(raw.stopAfter)
      : undefined

  return {
    slugs,
    submissionIds,
    target,
    stopAfter,
    phases: parseEnrichPhases(raw.phases),
    status: parseStatus(raw.status),
  }
}

export async function runSubmissionEnrichment(
  supabase: Supabase,
  params: JobParams,
  config: {
    dryRun: boolean
    slugs?: string[]
    limit?: number
    phases?: EnrichPhase[]
    onProgress?: (message: string) => void
  }
): Promise<OperationWithSummary> {
  const startedAt = Date.now()
  const submissionIds = params.submissionIds ?? []
  const result: CurationOperationResult = {
    processed: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    brandOutcomes: [],
  }
  const { data, error } = await supabase
    .from('brand_submissions')
    .select('id, brand_id, brand_name')
    .in('id', submissionIds)

  if (error) {
    result.errors.push(error.message)
    return attachEnrichmentSummary(result, Date.now() - startedAt)
  }

  const submissions = (data ?? []) as Array<{ id: string; brand_id: string | null; brand_name: string }>
  const linkedBrandIds = submissions
    .map((submission) => submission.brand_id)
    .filter((brandId): brandId is string => Boolean(brandId))
  const directSubmissions = submissions.filter((submission) => !submission.brand_id)
  const slugs = await getBrandSlugsForIds(supabase, linkedBrandIds)
  const brandSlugs = [...new Set([...(params.slugs ?? []), ...slugs])]

  if (brandSlugs.length > 0) {
    const brandResult = await runEnrich(
      {
        ...config,
        slugs: brandSlugs,
        status: params.status,
        phases: params.phases ?? config.phases ?? [...ENRICH_PHASES],
      },
      operationSupabase(supabase)
    )
    result.processed += brandResult.processed
    result.updated += brandResult.updated
    result.skipped += brandResult.skipped
    result.errors.push(...brandResult.errors)
    result.brandOutcomes.push(...brandResult.brandOutcomes)
  }

  const directIds = directSubmissions.map((submission) => submission.id)
  if (directIds.length > 0) {
    const directResult = await runEnrich(
      {
        ...config,
        target: 'submissions',
        submissionIds: directIds,
        status: params.status,
        phases: params.phases ?? config.phases ?? [...ENRICH_PHASES],
      },
      operationSupabase(supabase)
    )
    result.processed += directResult.processed
    result.updated += directResult.updated
    result.skipped += directResult.skipped
    result.errors.push(...directResult.errors)
    result.brandOutcomes.push(...directResult.brandOutcomes)
  }

  return attachEnrichmentSummary(result, Date.now() - startedAt)
}

async function getBrandSlugsForIds(supabase: Supabase, brandIds: string[]): Promise<string[]> {
  if (brandIds.length === 0) {
    return []
  }

  const { data, error } = await supabase
    .from('brands')
    .select('slug')
    .in('id', brandIds)

  if (error) {
    throw error
  }

  return ((data ?? []) as Array<{ slug: string | null }>)
    .map((brand) => brand.slug)
    .filter((slug): slug is string => typeof slug === 'string' && slug.trim() !== '')
}

const BRAND_STATUSES: readonly BrandStatus[] = ['approved', 'hidden']
const ENRICH_TARGETS: readonly EnrichTarget[] = ['brands', 'submissions']

function parseTarget(value: unknown): EnrichTarget | undefined {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return ENRICH_TARGETS.includes(trimmed as EnrichTarget) ? (trimmed as EnrichTarget) : undefined
}

function parseStatus(value: unknown): BrandStatus | undefined {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return BRAND_STATUSES.includes(trimmed as BrandStatus) ? (trimmed as BrandStatus) : undefined
}

function parseEnrichPhases(value: unknown): EnrichPhase[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }

  const phases = value.filter((phase): phase is EnrichPhase =>
    typeof phase === 'string' && (ENRICH_PHASES as readonly string[]).includes(phase)
  )

  return phases.length > 0 ? [...new Set(phases)] : undefined
}

function normalizeOperationResult(result: CurationOperationResult): OperationResult {
  const errors = result.errors.map(parseOperationError)
  const brandOutcomes = getBrandOutcomes(result, errors)

  return {
    processed: result.processed,
    total: operationResultTotal(result),
    skipped: result.skipped,
    failed: result.errors.length,
    changed: result.updated,
    changes: [],
    errors,
    brandOutcomes,
  }
}

function getBrandOutcomes(
  result: CurationOperationResult,
  errors: Array<{ slug: string; error: string }>
): BrandOutcome[] {
  if (result.brandOutcomes.length > 0) {
    return result.brandOutcomes
  }

  return errors.map((error) => ({
    slug: error.slug,
    name: error.slug,
    status: 'failed' as const,
    error: error.error,
  }))
}

function parseOperationError(error: string): { slug: string; error: string } {
  const match = error.match(/^([^:]+):\s+(.+)$/)

  if (!match) {
    return { slug: '', error }
  }

  const [, slug, message] = match
  return { slug: slug.trim(), error: message.trim() }
}

function progressJson(progress: ProgressJsonInput): Json {
  return {
    processed: progress.processed,
    total: progress.total,
    skipped: progress.skipped,
    failed: progress.failed,
  } as Json
}

async function updateJob(supabase: Supabase, jobId: string, patch: CurationJobUpdate): Promise<void> {
  const { error } = await curationJobs(supabase)
    .update(patch)
    .eq('id', jobId)

  if (error) {
    throw error
  }
}

function operationResultTotal(result: CurationOperationResult): number {
  const total = (result as CurationOperationResult & { total?: unknown }).total
  return typeof total === 'number' && Number.isFinite(total) ? total : result.processed
}

function failedJobSummary(
  job: CurationJob,
  error: string,
  durationMs: number
): EnrichmentSummary {
  return {
    success: 0,
    skipped: 0,
    failed: 1,
    failedBrands: [{ slug: job.id, phase: 'job', error }],
    durationMs,
  }
}

function attachEnrichmentSummary(
  result: CurationOperationResult,
  durationMs: number
): OperationWithSummary {
  return {
    ...result,
    enrichmentSummary: createEnrichmentSummary(result, durationMs),
  }
}

function curationJobs(supabase: Supabase): CurationJobsTable {
  const from = supabase.from.bind(supabase) as unknown
  const fromCurationJobs = from as CurationJobsFrom
  return fromCurationJobs('curation_jobs')
}

function operationSupabase(supabase: Supabase): OperationSupabase {
  return supabase as unknown as OperationSupabase
}
