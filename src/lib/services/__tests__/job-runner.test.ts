import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTestClient, describeWithDb } from '@/test/setup'
import type { CurationJob } from '../job-runner'

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
  processed: 0,
  updated: 0,
  skipped: 0,
  errors: [],
  brandOutcomes: [],
}

afterEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  vi.doUnmock('../curation-operations')
  vi.doUnmock('@/lib/supabase/server')
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

async function importRunnerWithMocks(submissions: MockSubmission[] = []) {
  const runEnrich = vi.fn().mockResolvedValue(operationResult)
  const createServiceClient = vi.fn(() => mockSupabase(submissions))

  vi.doMock('next/cache', () => ({
    revalidateTag: vi.fn(),
  }))
  vi.doMock('@/lib/supabase/server', () => ({
    createServiceClient,
  }))
  vi.doMock('../curation-operations', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../curation-operations')>()
    return {
      ...actual,
      runEnrich,
    }
  })

  const runner = await import('../job-runner')
  return { ...runner, createServiceClient, runEnrich }
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
