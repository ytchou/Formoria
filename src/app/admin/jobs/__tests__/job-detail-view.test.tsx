// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CurationJob, CurationJobDetail, CurationJobTarget } from '@/lib/services/curation-jobs'
import { rerunCurationJobAction } from '@/app/admin/operations/actions'
import { JobDetailView } from '../[id]/job-detail-view'

const push = vi.fn()
const dispatchCurationJobAction = vi.hoisted(() => vi.fn())
const retryCurationDispatchAction = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push }),
}))
vi.mock('@/app/admin/operations/actions', () => ({
  rerunCurationJobAction: vi.fn(),
  dispatchCurationJobAction,
  retryCurationDispatchAction,
}))
vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

describe('JobDetailView', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows Run now for a queued job and does not offer duplicate actions while running', async () => {
    dispatchCurationJobAction.mockResolvedValue({
      jobId: 'job-1',
      detailPath: '/admin/jobs/job-1',
      queued: true,
      dispatchStatus: 'dispatched',
      message: 'Accepted',
    })
    const user = userEvent.setup()
    const queuedDetail = detail()
    queuedDetail.job = job({
      status: 'pending',
      dispatch_status: 'pending',
      completed_at: null,
      started_at: null,
      target_total: 1,
      succeeded_count: 0,
      failed_count: 0,
    })
    queuedDetail.targets = [target({ status: 'pending' })]

    render(<JobDetailView detail={queuedDetail} selectedStatus="all" />)

    expect(screen.getByRole('button', { name: 'Run now' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Rerun/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Run now' }))
    expect(dispatchCurationJobAction).toHaveBeenCalledWith('job-1')
  })

  it('shows retry lineage, target phase details, changed fields, and sanitized errors', async () => {
    const user = userEvent.setup()
    render(<JobDetailView detail={detail()} selectedStatus="all" />)

    expect(screen.getByText('Completed with failures')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Rerun failed submissions/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Previous job/ })).toHaveAttribute('href', '/admin/jobs/parent-job')

    const targetRow = screen.getByText('台北工坊').closest('tr')
    expect(targetRow).not.toBeNull()
    await user.click(within(targetRow!).getByText('View details'))
    expect(within(targetRow!).getByText('descriptions')).toBeInTheDocument()
    expect(within(targetRow!).getByText(/Changed: description, price_range/)).toBeInTheDocument()
    expect(screen.getAllByText('Provider timeout').length).toBeGreaterThan(0)
  })

  it('queues exactly the failed targets through the manual rerun action', async () => {
    vi.mocked(rerunCurationJobAction).mockResolvedValue({
      jobId: 'manual-job',
      detailPath: '/admin/jobs/manual-job',
      queued: true,
      dispatchStatus: 'dispatched',
      message: 'Rerun job created for failed or unfinished brands, dispatching now.',
    })
    const user = userEvent.setup()
    render(<JobDetailView detail={detail()} selectedStatus="failed" />)

    await user.click(screen.getByRole('button', { name: /Rerun failed submissions/ }))

    expect(rerunCurationJobAction).toHaveBeenCalledWith('job-1')
    expect(push).toHaveBeenCalledWith('/admin/jobs/manual-job')
  })

  it('filters the target list using a shareable status URL', () => {
    render(<JobDetailView detail={detail()} selectedStatus="succeeded" />)

    expect(screen.queryByText('台北工坊')).not.toBeInTheDocument()
    expect(screen.getByText('成功品牌')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Failed' })).toHaveAttribute('href', '/admin/jobs/job-1?status=failed')
  })
})

function detail(): CurationJobDetail {
  return {
    job: job(),
    parent: job({ id: 'parent-job', trigger: 'cron', attempt: 1 }),
    children: [],
    targets: [
      target(),
      target({
        id: 'target-row-2',
        target_id: 'brand-2',
        brand_name: '成功品牌',
        brand_slug: 'successful-brand',
        status: 'succeeded',
        phase_results: [],
        changed_fields: [],
        error: null,
      }),
    ],
  }
}

function job(overrides: Partial<CurationJob> = {}): CurationJob {
  return {
    id: 'job-1',
    operation: 'enrich',
    status: 'completed',
    trigger: 'automatic_retry',
    attempt: 2,
    parent_job_id: 'parent-job',
    params: { target: 'brands' },
    dry_run: false,
    progress: null,
    result: null,
    started_by: 'railway-worker',
    created_at: '2026-07-13T16:00:00.000Z',
    started_at: '2026-07-13T16:00:01.000Z',
    completed_at: '2026-07-13T16:00:11.000Z',
    scheduled_for: '2026-07-13T16:00:00.000Z',
    run_after: '2026-07-13T16:10:00.000Z',
    dedupe_key: null,
    heartbeat_at: '2026-07-13T16:00:11.000Z',
    worker_token: null,
    job_error: null,
    current_target_id: null,
    current_phase: null,
    target_total: 2,
    succeeded_count: 1,
    skipped_count: 0,
    failed_count: 1,
    dispatch_status: 'dispatched',
    dispatch_error: null,
    dispatched_at: '2026-07-13T16:00:01.000Z',
    ...overrides,
  }
}

function target(overrides: Partial<CurationJobTarget> = {}): CurationJobTarget {
  return {
    id: 'target-row-1',
    job_id: 'job-1',
    target_type: 'brand',
    target_id: 'brand-1',
    brand_name: '台北工坊',
    brand_slug: 'taipei-maker',
    status: 'failed',
    current_phase: null,
    phase_results: [
      {
        phase: 'descriptions',
        status: 'failed',
        changedFields: ['description', 'price_range'],
        durationMs: 1_250,
        error: 'Provider timeout',
      },
    ],
    changed_fields: ['description', 'price_range'],
    error: 'Provider timeout',
    started_at: '2026-07-13T16:00:01.000Z',
    completed_at: '2026-07-13T16:00:03.000Z',
    duration_ms: 2_000,
    created_at: '2026-07-13T16:00:00.000Z',
    ...overrides,
  }
}
