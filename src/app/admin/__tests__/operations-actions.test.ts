import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CurationJob } from '@/lib/services/curation-jobs'

const getUser = vi.fn()
const isActingAsAdmin = vi.fn()
const recoverStaleJobs = vi.fn()
const checkForRunningJob = vi.fn()
const createCurationJob = vi.fn()
const listCurationJobs = vi.fn()
const runJob = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser },
  })),
}))

vi.mock('@/lib/auth/admin-mode', () => ({
  isActingAsAdmin,
}))

vi.mock('@/lib/services/curation-jobs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/curation-jobs')>()
  return {
    ...actual,
    recoverStaleJobs,
    checkForRunningJob,
    createCurationJob,
    listCurationJobs,
  }
})

vi.mock('@/lib/services/job-runner', () => ({
  runJob,
}))

describe('curation server actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getUser.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'admin@example.com' } },
      error: null,
    })
    isActingAsAdmin.mockResolvedValue(true)
    recoverStaleJobs.mockResolvedValue(undefined)
    checkForRunningJob.mockResolvedValue({ hasRunningJob: false })
    createCurationJob.mockImplementation(async ({ params }) => ({
      job: job({ id: `job-${createCurationJob.mock.calls.length}`, params }),
    }))
    runJob.mockResolvedValue({
      success: 1,
      skipped: 0,
      failed: 0,
      failedBrands: [],
      durationMs: 10,
    })
  })

  it('exports startCurationJobAction', async () => {
    const mod = await import('../operations/actions')
    expect(mod.startCurationJobAction).toBeDefined()
    expect(typeof mod.startCurationJobAction).toBe('function')
  })

  it('recovers stale jobs before checking for a running job', async () => {
    const callOrder: string[] = []
    recoverStaleJobs.mockImplementationOnce(async () => {
      callOrder.push('recover')
    })
    checkForRunningJob.mockImplementationOnce(async () => {
      callOrder.push('check')
      return { hasRunningJob: false }
    })

    const { startCurationJobAction } = await import('../operations/actions')
    await startCurationJobAction('enrich', { submissionIds: ['sub-1'] }, false)

    expect(callOrder).toEqual(['recover', 'check'])
  })

  it('batches submission ids into pending curation jobs', async () => {
    const { startCurationJobAction } = await import('../operations/actions')
    const submissionIds = Array.from({ length: 23 }, (_, index) => `sub-${index + 1}`)

    await startCurationJobAction('enrich', { submissionIds }, false)

    expect(createCurationJob).toHaveBeenCalledTimes(2)
    expect(createCurationJob).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        params: expect.objectContaining({ submissionIds: submissionIds.slice(0, 20) }),
      })
    )
    expect(createCurationJob).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        params: expect.objectContaining({ submissionIds: submissionIds.slice(20) }),
      })
    )
    expect(runJob).toHaveBeenCalledWith(expect.objectContaining({ id: 'job-1' }))
  })

  it('returns queued jobs when a job is already running', async () => {
    checkForRunningJob.mockResolvedValueOnce({ hasRunningJob: true })
    const { startCurationJobAction } = await import('../operations/actions')

    const result = await startCurationJobAction(
      'enrich',
      { submissionIds: Array.from({ length: 23 }, (_, index) => `sub-${index + 1}`) },
      false
    )

    expect(result).toMatchObject({
      queued: true,
      jobIds: ['job-1', 'job-2'],
    })
    expect(runJob).not.toHaveBeenCalled()
  })
})

function job(overrides: Partial<CurationJob> = {}): CurationJob {
  return {
    id: 'job-1',
    operation: 'enrich',
    status: 'pending',
    params: null,
    dry_run: false,
    progress: null,
    result: null,
    started_by: 'admin@example.com',
    created_at: null,
    started_at: null,
    completed_at: null,
    ...overrides,
  }
}
