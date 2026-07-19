// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CurationJob } from '@/lib/services/curation-jobs'
import { JobHistoryList } from '../job-history-list'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}))

describe('JobHistoryList', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.useRealTimers())

  it('links each run and highlights completed runs with target failures', () => {
    render(<JobHistoryList initialJobs={[job({ status: 'completed', failed_count: 2 })]} />)

    expect(screen.getByRole('link', { name: /2026/ })).toHaveAttribute('href', '/admin/jobs/job-1')
    expect(screen.getByText('Completed with failures')).toBeInTheDocument()
    expect(screen.getByText('0 ok, 0 skipped, 2 failed')).toBeInTheDocument()
    expect(screen.getByText('Scheduled')).toBeInTheDocument()
  })

  it('polls every five seconds only while a visible run is active', () => {
    vi.useFakeTimers()
    const { rerender } = render(<JobHistoryList initialJobs={[job({ status: 'running' })]} />)

    act(() => vi.advanceTimersByTime(5_000))
    expect(refresh).toHaveBeenCalledOnce()

    rerender(<JobHistoryList initialJobs={[job({ status: 'completed' })]} />)
    act(() => vi.advanceTimersByTime(10_000))
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('renders one unified log with cancellation only for active work', () => {
    render(
      <JobHistoryList
        initialJobs={[
          job({ id: 'running-job', status: 'running' }),
          job({ id: 'failed-job', status: 'failed', dispatch_status: 'failed', dispatch_error: 'worker unavailable' }),
        ]}
      />,
    )

    expect(screen.getByText('Dispatch failed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel job' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry dispatch' })).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Filter data jobs' })).not.toBeInTheDocument()
  })
})

function job(overrides: Partial<CurationJob> = {}): CurationJob {
  return {
    id: 'job-1',
    operation: 'enrich',
    status: 'pending',
    trigger: 'cron',
    attempt: 1,
    parent_job_id: null,
    params: { target: 'submissions' },
    dry_run: false,
    progress: null,
    result: null,
    started_by: 'railway-cron',
    created_at: '2026-07-13T16:00:00.000Z',
    started_at: '2026-07-13T16:00:01.000Z',
    completed_at: '2026-07-13T16:00:11.000Z',
    scheduled_for: '2026-07-13T16:00:00.000Z',
    run_after: '2026-07-13T16:00:00.000Z',
    dedupe_key: 'submission-enrichment:2026-07-13T16:00:00.000Z',
    heartbeat_at: '2026-07-13T16:00:11.000Z',
    worker_token: null,
    job_error: null,
    current_target_id: null,
    current_phase: null,
    target_total: 2,
    succeeded_count: 0,
    skipped_count: 0,
    failed_count: 0,
    dispatch_status: 'pending',
    dispatch_error: null,
    dispatched_at: null,
    ...overrides,
  }
}
