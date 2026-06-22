import { revalidateTag } from 'next/cache'
import { NextResponse } from 'next/server'
import { isAdmin } from '@/lib/auth/admin'
import {
  runCleanup,
  runEnrich,
  runSetVisibility,
  type OperationResult as CurationOperationResult,
} from '@/lib/services/curation-operations'
import { createServiceClient } from '@/lib/supabase/server'
import type { Json } from '@/lib/supabase/database.types'

export const VALID_OPERATIONS = ['cleanup', 'enrich', 'set-visibility'] as const
export const DEPRECATED_OPERATIONS = [
  'clean-names',
  'normalize-slugs',
  'detect-non-brands',
  'enrich-descriptions',
  'enrich-links',
  'enrich-images',
  'score-and-scrape',
] as const

const STALE_JOB_MINUTES = 30
const ENRICH_PHASES = ['discover', 'links', 'images', 'descriptions', 'tags'] as const

type Supabase = ReturnType<typeof createServiceClient>
type OperationSupabase = Parameters<typeof runCleanup>[1]
type ValidOperation = (typeof VALID_OPERATIONS)[number]
type CurationJobStatus = 'pending' | 'running' | 'completed' | 'failed'
type EnrichPhase = (typeof ENRICH_PHASES)[number]
type CurationJob = {
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
type JobParams = {
  slugs?: string[]
  stopAfter?: number
  phases?: EnrichPhase[]
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
}
type CurationJobsTable = {
  select: (columns: string) => {
    eq: (column: string, value: string) => {
      single: () => Promise<{ data: CurationJob | null; error: { message: string } | null }>
    }
  }
  update: (patch: CurationJobUpdate) => {
    eq: (column: string, value: string) => PromiseLike<{ error: { message: string } | null }> & {
      neq: (column: string, value: string) => {
        lt: (column: string, value: string) => Promise<{ error: { message: string } | null }>
      }
    }
  }
}
type CurationJobsFrom = (table: 'curation_jobs') => CurationJobsTable
type RevalidateTagOneArg = (tag: string) => void

export async function POST(request: Request) {
  let jobId: unknown

  try {
    const body = await request.json()
    jobId = body?.jobId
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (typeof jobId !== 'string' || jobId.trim() === '') {
    return NextResponse.json({ error: 'Missing jobId' }, { status: 400 })
  }

  const supabase = createServiceClient()
  const { data: job, error } = await curationJobs(supabase)
    .select('*')
    .eq('id', jobId)
    .single()

  if (error || !job) {
    return NextResponse.json({ error: error?.message ?? 'Job not found' }, { status: 404 })
  }

  if (!isAdmin(job.started_by)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  runJob(job).catch((err) => {
    console.error('[admin:run-job]', err)
  })

  return NextResponse.json({ jobId: job.id, status: 'accepted' }, { status: 202 })
}

async function runJob(job: CurationJob): Promise<void> {
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
    total: params.stopAfter ?? params.slugs?.length ?? 0,
    skipped: 0,
    failed: 0,
  }
  let progressUpdate = Promise.resolve()
  const config = {
    dryRun: job.dry_run,
    slugs: params.slugs,
    limit: params.stopAfter,
    onProgress: () => {
      progress.processed += 1
      const nextProgress = { ...progress }
      progressUpdate = progressUpdate
        .then(() => updateProgress(supabase, job.id, nextProgress))
        .catch((error) => {
          console.error('[admin:run-job] progress update failed:', error)
        })
    },
  }
  let result: CurationOperationResult

  switch (operation) {
    case 'cleanup':
      result = await runCleanup(config, operationSupabase(supabase))
      break
    case 'enrich':
      result = await runEnrich(
        {
          ...config,
          phases: params.phases ?? [...ENRICH_PHASES],
        },
        operationSupabase(supabase)
      )
      break
    case 'set-visibility':
      result = await runSetVisibility(config, operationSupabase(supabase))
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
    throw new Error(`Operation deprecated: ${operation}`)
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
  const stopAfter =
    typeof raw.stopAfter === 'number' && Number.isFinite(raw.stopAfter) && raw.stopAfter > 0
      ? Math.floor(raw.stopAfter)
      : undefined

  return {
    slugs,
    stopAfter,
    phases: parseEnrichPhases(raw.phases),
  }
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
  return {
    processed: result.processed,
    total: result.processed,
    skipped: result.skipped,
    failed: result.errors.length,
    changed: result.updated,
    changes: [],
    errors: result.errors.map(parseOperationError),
  }
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
  const { error } = await curationJobs(supabase)
    .update({
      status: 'failed',
      completed_at: new Date().toISOString(),
      result: { error: 'Job timed out (stale recovery)' } as Json,
    })
    .eq('status', 'running')
    .neq('id', currentJobId)
    .lt('started_at', staleBefore)

  if (error) {
    throw error
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
