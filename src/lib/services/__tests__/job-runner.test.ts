import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTestClient, describeWithDb } from '@/test/setup'
import type { EnrichmentSummary } from '@/lib/services/enrichment-logger'
import type { CurationJob } from '@/lib/services/curation-jobs'

const dbClient =
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createTestClient()
    : null

type MockSubmission = {
  id: string
  brand_id: string | null
  brand_name: string
}

const operationResult = {
  processed: 1,
  updated: 1,
  skipped: 0,
  errors: [],
  brandOutcomes: [{ slug: 'brand-a', name: 'Brand A', status: 'succeeded' as const }],
  enrichmentSummary: {
    success: 1,
    skipped: 0,
    failed: 0,
    failedBrands: [],
    durationMs: 10,
  },
}

afterEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  vi.doUnmock('../curation-operations')
  vi.doUnmock('@/lib/supabase/server')
  vi.doUnmock('@/lib/services/curation-jobs')
  vi.doUnmock('next/cache')
})

describe('job-runner enrich routing', () => {
  it('should default to submissions target when no slugs or submissionIds', async () => {
    const { runEnrich, runJob } = await importRunnerWithMocks()

    await runJob(job({ params: {} }))

    expect(runEnrich).toHaveBeenCalledWith(
      expect.objectContaining({ target: 'submissions' }),
      expect.anything()
    )
  })

  it('should set brands target when slugs provided', async () => {
    const { runEnrich, runJob } = await importRunnerWithMocks()

    await runJob(job({ params: { slugs: ['brand-a'] } }))

    expect(runEnrich).toHaveBeenCalledWith(
      expect.objectContaining({ slugs: ['brand-a'], target: 'brands' }),
      expect.anything()
    )
  })

  it('should route to runSubmissionEnrichment when submissionIds provided', async () => {
    const { runEnrich, runJob } = await importRunnerWithMocks([
      { id: 'id-1', brand_id: null, brand_name: 'Brand One' },
      { id: 'id-2', brand_id: null, brand_name: 'Brand Two' },
    ])

    await runJob(job({ params: { submissionIds: ['id-1', 'id-2'] } }))

    expect(runEnrich).toHaveBeenCalledWith(
      expect.objectContaining({
        submissionIds: ['id-1', 'id-2'],
        target: 'submissions',
      }),
      expect.anything()
    )
  })
})

describe('job-runner single-job processing', () => {
  it('processes exactly one job per call without draining the queue', async () => {
    const { runEnrich, runJob } = await importRunnerWithMocks()

    const summary = await runJob(job({ id: 'job-1', params: { slugs: ['brand-a'] } }))

    expect(runEnrich).toHaveBeenCalledTimes(1)
    expect(summary).toMatchObject({ success: 1, skipped: 0, failed: 0, durationMs: 10 })
  })

  it('returns a failed summary when the job throws without processing further jobs', async () => {
    const runEnrich = vi.fn().mockRejectedValueOnce(new Error('first job failed'))
    const { runJob } = await importRunnerWithMocks([], runEnrich)

    const summary = await runJob(job({ id: 'job-1' }))

    expect(runEnrich).toHaveBeenCalledTimes(1)
    expect(summary.success).toBe(0)
    expect(summary.failed).toBe(1)
    expect(summary.failedBrands[0]).toMatchObject({
      slug: 'job-1',
      phase: 'job',
      error: 'first job failed',
    })
  })

  it('calls recoverStaleJobs at the start of each run', async () => {
    const { recoverStaleJobs, runJob } = await importRunnerWithMocks()

    await runJob(job({ id: 'job-1' }))

    expect(recoverStaleJobs).toHaveBeenCalledTimes(1)
  })

  it('merges enrichment summaries from multiple jobs', async () => {
    const { mergeSummaries } = await import('../job-runner')
    const summaries: EnrichmentSummary[] = [
      {
        success: 2,
        skipped: 1,
        failed: 1,
        failedBrands: [{ slug: 'a', phase: 'links', error: 'bad url' }],
        durationMs: 100,
      },
      {
        success: 3,
        skipped: 2,
        failed: 1,
        failedBrands: [{ slug: 'b', phase: 'images', error: 'missing' }],
        durationMs: 250,
      },
    ]

    expect(mergeSummaries(summaries)).toEqual({
      success: 5,
      skipped: 3,
      failed: 2,
      failedBrands: [
        { slug: 'a', phase: 'links', error: 'bad url' },
        { slug: 'b', phase: 'images', error: 'missing' },
      ],
      durationMs: 350,
    })
  })
})

describeWithDb('runSubmissionEnrichment direct submissions', () => {
  const supabase = dbClient!
  let submissionId: string | null = null

  afterEach(async () => {
    if (submissionId) {
      await supabase.from('brand_submissions').delete().eq('id', submissionId)
      submissionId = null
    }
  })

  it('should call runEnrich with target=submissions for direct submissions', async () => {
    const { data: submission, error } = await supabase
      .from('brand_submissions')
      .insert({
        brand_name: '[TEST-JOB-RUNNER] Direct Submission',
        submitter_email: 'job-runner-direct@example.com',
        status: 'pending',
        brand_id: null,
      })
      .select('id')
      .single()

    if (error) {
      throw error
    }

    const insertedSubmissionId = submission!.id
    submissionId = insertedSubmissionId

    const { runSubmissionEnrichment } = await import('../job-runner')
    const result = await runSubmissionEnrichment(
      supabase as never,
      { submissionIds: [insertedSubmissionId] },
      { dryRun: true, phases: ['clean'] }
    )

    expect(result.processed).toBeGreaterThanOrEqual(0)
  })
})

async function importRunnerWithMocks(
  submissions: MockSubmission[] = [],
  runEnrich = vi.fn().mockResolvedValue(operationResult)
) {
  const createServiceClient = vi.fn(() => mockSupabase(submissions))
  const recoverStaleJobs = vi.fn().mockResolvedValue(undefined)

  vi.doMock('next/cache', () => ({
    revalidateTag: vi.fn(),
  }))
  vi.doMock('@/lib/supabase/server', () => ({
    createServiceClient,
  }))
  vi.doMock('@/lib/services/curation-jobs', () => ({
    recoverStaleJobs,
  }))
  vi.doMock('../curation-operations', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../curation-operations')>()
    return {
      ...actual,
      runEnrich,
    }
  })

  const runner = await import('../job-runner')
  return { ...runner, createServiceClient, recoverStaleJobs, runEnrich }
}

function job(overrides: Partial<CurationJob> = {}): CurationJob {
  return {
    id: 'job-1',
    operation: 'enrich',
    status: 'pending',
    params: null,
    dry_run: true,
    progress: null,
    result: null,
    started_by: 'tester',
    created_at: null,
    started_at: null,
    completed_at: null,
    ...overrides,
  }
}

function mockSupabase(submissions: MockSubmission[]) {
  return {
    from: vi.fn((table: string) => {
      if (table === 'curation_jobs') {
        return {
          update: vi.fn(() => mutation()),
        }
      }

      if (table === 'brand_submissions') {
        return {
          select: vi.fn(() => ({
            in: vi.fn(async () => ({ data: submissions, error: null })),
          })),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    }),
  }
}

function mutation() {
  return {
    eq: vi.fn(() => Promise.resolve({ error: null })),
    neq: vi.fn(() => ({
      or: vi.fn(() => Promise.resolve({ error: null })),
    })),
  }
}
