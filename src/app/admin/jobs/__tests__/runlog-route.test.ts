import { beforeEach, describe, expect, it, vi } from 'vitest'
import { requireAdminAction } from '@/lib/auth/require-admin'
import { getRequestOrigin } from '@/lib/auth/site-url'
import { exportJobRunLog } from '@/lib/services/runlog-export'
import { renderRunLogHtml } from '@/lib/runlog'
import { GET } from '../[id]/runlog/route'

vi.mock('@/lib/auth/require-admin', () => ({ requireAdminAction: vi.fn() }))
vi.mock('@/lib/auth/site-url', () => ({ getRequestOrigin: vi.fn() }))
vi.mock('@/lib/services/runlog-export', () => ({ exportJobRunLog: vi.fn() }))
vi.mock('@/lib/runlog', () => ({ renderRunLogHtml: vi.fn() }))

describe('admin runlog route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAdminAction).mockResolvedValue({ user: { id: 'admin-1', email: 'admin@formoria.com' } })
    vi.mocked(getRequestOrigin).mockResolvedValue('https://formoria.com')
    vi.mocked(exportJobRunLog).mockResolvedValue({ run: { id: 'job-1' } } as never)
    vi.mocked(renderRunLogHtml).mockReturnValue('<!doctype html><title>Run log</title>')
  })

  it('returns a self-contained HTML response for an admin', async () => {
    const response = await GET(
      new Request('https://formoria.example/admin/jobs/job-1/runlog'),
      { params: Promise.resolve({ id: 'job-1' }) },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(await response.text()).toContain('<title>Run log</title>')
  })

  it('adds an attachment filename for downloads', async () => {
    const response = await GET(
      new Request('https://formoria.example/admin/jobs/job-1/runlog?download=1'),
      { params: Promise.resolve({ id: 'job-1' }) },
    )

    expect(response.headers.get('content-disposition')).toBe('attachment; filename="runlog-job-1.html"')
  })

  it('redirects anonymous requests to sign in', async () => {
    vi.mocked(requireAdminAction).mockResolvedValue({ error: 'Authentication required', code: 'unauthenticated' })

    const response = await GET(
      new Request('http://localhost:8080/admin/jobs/job-1/runlog'),
      { params: Promise.resolve({ id: 'job-1' }) },
    )

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      'https://formoria.com/auth/sign-in?next=%2Fadmin%2Fjobs%2Fjob-1%2Frunlog',
    )
  })
})
