import { revalidateTag } from 'next/cache'
import {
  ENRICH_PHASES,
  enrichSubmission,
  runEnrich,
  type BrandOutcome,
  type OperationResult as CurationOperationResult,
} from '@/lib/services/curation-operations'
import { createServiceClient } from '@/lib/supabase/server'
import type { Json } from '@/lib/supabase/database.types'

export const VALID_OPERATIONS = ['enrich'] as const
export const DEPRECATED_OPERATIONS = [
  'clean-names',
  'normalize-slugs',
  'detect-non-brands',
  'enrich-descriptions',
  'enrich-links',
  'enrich-images',
  'score-and-scrape',
  'set-visibility',
] as const

const STALE_JOB_MINUTES = 30
const STALE_PENDING_JOB_MINUTES = 10

type Supabase = ReturnType<typeof createServiceClient>
type OperationSupabase = Parameters<typeof runEnrich>[1]
type ValidOperation = (typeof VALID_OPERATIONS)[number]
type CurationJobStatus = 'pending' | 'running' | 'completed' | 'failed'
type EnrichPhase = (typeof ENRICH_PHASES)[number]
export type CurationJob = {
  id: string
  operation: string
  status: CurationJobStatus
  params: Json | null
  dry_run: boolean
  progress: Json | null
  result: Json | null
  started_by: string
  created_at: string | null
  started_at: string | null
  completed_at: string | null
}
type CurationJobUpdate = Partial<
  Pick<CurationJob, 'status' | 'progress' | 'result' | 'started_at' | 'completed_at'>
>
type BrandStatus = 'approved' | 'hidden'

type JobParams = {
  slugs?: string[]
  submissionIds?: string[]
  stopAfter?: number
  phases?: EnrichPhase[]
  status?: BrandStatus
}
type Progress = {
  processed: number
  total: number
  skipped: number
  failed: number
}
type OperationResult = Progress & {
  changed: number
  changes: Array<Record<string, unknown>>
  errors: Array<{ slug: string; error: string }>
  brandOutcomes: BrandOutcome[]
}
type CurationJobsMutation = PromiseLike<{ error: { message: string } | null }> & {
  eq: (column: string, value: string) => CurationJobsMutation
  neq: (column: string, value: string) => CurationJobsMutation
  lt: (column: string, value: string) => CurationJobsMutation
  or: (filter: string) => CurationJobsMutation
}
type CurationJobsTable = {
  select: (columns: string) => {
    eq: (column: string, value: string) => {
      single: () => Promise<{ data: CurationJob | null; error: { message: string } | null }>
    }
  }
  update: (patch: CurationJobUpdate) => CurationJobsMutation
}
type CurationJobsFrom = (table: 'curation_jobs') => CurationJobsTable
type RevalidateTagOneArg = (tag: string) => void

export async function fetchJob(jobId: string): Promise<{ data: CurationJob | null; error: { message: string } | null }> {
  const supabase = createServiceClient()
  return curationJobs(supabase)
    .select('*')
    .eq('id', jobId)
    .single()
}

export async function runJob(job: CurationJob): Promise<void> {
  const supabase = createServiceClient()

  try {
    await recoverStaleJobs(supabase, job.id)
    await updateJob(supabase, job.id, {
      status: 'running',
      started_at: new Date().toISOString(),
      progress: progressJson({ processed: 0, total: 0, skipped: 0, failed: 0 }),
    })

    const result = await runOperation(supabase, job)
    await updateJob(supabase, job.id, {
      status: 'completed',
      completed_at: new Date().toISOString(),
      progress: progressJson(result),
      result: result as unknown as Json,
    })
    const revalidateTagOneArg = revalidateTag as RevalidateTagOneArg
    revalidateTagOneArg('quality-metrics')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await updateJob(supabase, job.id, {
      status: 'failed',
      completed_at: new Date().toISOString(),
      result: { error: message } as Json,
    })
  }
}

async function runOperation(supabase: Supabase, job: CurationJob): Promise<OperationResult> {
  const operation = parseOperation(job.operation)
  const params = parseParams(job.params)
  const progress: Progress = {
    processed: 0,
    total: params.stopAfter ?? params.slugs?.length ?? params.submissionIds?.length ?? 0,
    skipped: 0,
    failed: 0,
  }
  let progressUpdate = Promise.resolve()
  const config = {
    dryRun: job.dry_run,
    slugs: params.slugs,
    limit: params.stopAfter,
    onProgress: (message: string) => {
      const processed = processedBrandCount(message)
      if (processed === undefined) {
        return
      }

      progress.processed = processed
      progress.total = Math.max(progress.total, totalBrandCount(message) ?? progress.total)
      const nextProgress = { ...progress }
      progressUpdate = progressUpdate
        .then(() => updateProgress(supabase, job.id, nextProgress))
        .catch((error) => {
          console.error('[admin:run-job] progress update failed:', error)
        })
    },
  }
  let result: CurationOperationResult
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
          status,
          phases: params.phases ?? [...ENRICH_PHASES],
        },
        operationSupabase(supabase)
      )
      break
    default:
      throw new Error(`Unhandled operation: ${operation}`)
  }

  await progressUpdate
  return normalizeOperationResult(result)
}

function parseOperation(operation: string): ValidOperation {
  if ((VALID_OPERATIONS as readonly string[]).includes(operation)) {
    return operation as ValidOperation
  }

  if ((DEPRECATED_OPERATIONS as readonly string[]).includes(operation)) {
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
  const stopAfter =
    typeof raw.stopAfter === 'number' && Number.isFinite(raw.stopAfter) && raw.stopAfter > 0
      ? Math.floor(raw.stopAfter)
      : undefined

  return {
    slugs,
    submissionIds,
    stopAfter,
    phases: parseEnrichPhases(raw.phases),
    status: parseStatus(raw.status),
  }
}

async function runSubmissionEnrichment(
  supabase: Supabase,
  params: JobParams,
  config: {
    dryRun: boolean
    slugs?: string[]
    limit?: number
    onProgress: (message: string) => void
  }
): Promise<CurationOperationResult> {
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
    return result
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
        phases: params.phases ?? [...ENRICH_PHASES],
      },
      operationSupabase(supabase)
    )
    result.processed += brandResult.processed
    result.updated += brandResult.updated
    result.skipped += brandResult.skipped
    result.errors.push(...brandResult.errors)
    result.brandOutcomes.push(...brandResult.brandOutcomes)
  }

  for (const submission of directSubmissions) {
    result.processed += 1
    config.onProgress(`Processing submission-${submission.id} (${result.processed}/${submissionIds.length})`)

    try {
      if (!config.dryRun) {
        await enrichSubmission(supabase as unknown as Parameters<typeof enrichSubmission>[0], submission.id)
      }
      result.updated += 1
      result.brandOutcomes.push({
        slug: `submission-${submission.id}`,
        name: submission.brand_name,
        status: 'changed',
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      result.errors.push(`submission-${submission.id}: ${message}`)
      result.brandOutcomes.push({
        slug: `submission-${submission.id}`,
        name: submission.brand_name,
        status: 'failed',
        error: message,
      })
      result.skipped += 1
    }
  }

  return result
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

function progressJson(progress: Progress): Json {
  return {
    processed: progress.processed,
    total: progress.total,
    skipped: progress.skipped,
    failed: progress.failed,
  } as Json
}

async function updateProgress(supabase: Supabase, jobId: string, progress: Progress): Promise<void> {
  await updateJob(supabase, jobId, { progress: progressJson(progress) })
}

async function updateJob(supabase: Supabase, jobId: string, patch: CurationJobUpdate): Promise<void> {
  const { error } = await curationJobs(supabase)
    .update(patch)
    .eq('id', jobId)

  if (error) {
    throw error
  }
}

async function recoverStaleJobs(supabase: Supabase, currentJobId: string): Promise<void> {
  const staleBefore = new Date(Date.now() - STALE_JOB_MINUTES * 60 * 1000).toISOString()
  const pendingStaleBefore = new Date(
    Date.now() - STALE_PENDING_JOB_MINUTES * 60 * 1000
  ).toISOString()
  const { error } = await curationJobs(supabase)
    .update({
      status: 'failed',
      completed_at: new Date().toISOString(),
      result: { error: 'Job timed out (stale recovery)' } as Json,
    })
    .neq('id', currentJobId)
    .or(
      `and(status.eq.running,started_at.lt.${staleBefore}),and(status.eq.pending,created_at.lt.${pendingStaleBefore})`
    )

  if (error) {
    throw error
  }
}

function processedBrandCount(message: string): number | undefined {
  const match = message.match(/^Processing\s+\S+\s+\((\d+)\/\d+\)$/)
  return match ? Number(match[1]) : undefined
}

function totalBrandCount(message: string): number | undefined {
  const match = message.match(/^Processing\s+\S+\s+\(\d+\/(\d+)\)$/)
  return match ? Number(match[1]) : undefined
}

function operationResultTotal(result: CurationOperationResult): number {
  const total = (result as CurationOperationResult & { total?: unknown }).total
  return typeof total === 'number' && Number.isFinite(total) ? total : result.processed
}

function curationJobs(supabase: Supabase): CurationJobsTable {
  const from = supabase.from.bind(supabase) as unknown
  const fromCurationJobs = from as CurationJobsFrom
  return fromCurationJobs('curation_jobs')
}

function operationSupabase(supabase: Supabase): OperationSupabase {
  return supabase as unknown as OperationSupabase
}
