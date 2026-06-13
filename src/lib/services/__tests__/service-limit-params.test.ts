import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFrom } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

import { listClaimRequests } from '../claim-requests'
import { getFeedbackItems } from '../feedback'
import { getPendingEdits } from '../pending-edits'
import { getPendingReports } from '../reports'
import { getSubmissions } from '../submissions'

function createQueryChain(result: { data: unknown[] | null; error: unknown | null } = { data: [], error: null }) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    then: vi.fn((resolve: (value: typeof result) => unknown) => Promise.resolve(resolve(result))),
  }

  return chain
}

describe('service limit params', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('applies limit to getSubmissions when provided', async () => {
    const chain = createQueryChain()
    mockFrom.mockReturnValue(chain)

    await getSubmissions('pending', { limit: 5 })

    expect(mockFrom).toHaveBeenCalledWith('brand_submissions')
    expect(chain.select).toHaveBeenCalledWith('*')
    expect(chain.eq).toHaveBeenCalledWith('status', 'pending')
    expect(chain.order).toHaveBeenCalledWith('submitted_at', { ascending: false })
    expect(chain.limit).toHaveBeenCalledWith(5)
  })

  it('omits limit from getSubmissions when not provided', async () => {
    const chain = createQueryChain()
    mockFrom.mockReturnValue(chain)

    await getSubmissions('pending')

    expect(chain.limit).not.toHaveBeenCalled()
  })

  it('applies limit to getPendingEdits when provided', async () => {
    const chain = createQueryChain()
    mockFrom.mockReturnValue(chain)

    await getPendingEdits('pending', { limit: 3 })

    expect(mockFrom).toHaveBeenCalledWith('pending_brand_edits')
    expect(chain.select).toHaveBeenCalledWith(expect.stringContaining('brands('))
    expect(chain.eq).toHaveBeenCalledWith('status', 'pending')
    expect(chain.order).toHaveBeenCalledWith('created_at', { ascending: false })
    expect(chain.limit).toHaveBeenCalledWith(3)
  })

  it('applies limit to getPendingReports when provided', async () => {
    const chain = createQueryChain()
    mockFrom.mockReturnValue(chain)

    await getPendingReports({ limit: 5 })

    expect(mockFrom).toHaveBeenCalledWith('brand_reports')
    expect(chain.select).toHaveBeenCalledWith('*, brands(name, slug)')
    expect(chain.eq).toHaveBeenCalledWith('status', 'pending')
    expect(chain.order).toHaveBeenCalledWith('created_at', { ascending: false })
    expect(chain.limit).toHaveBeenCalledWith(5)
  })

  it('applies limit to listClaimRequests when provided', async () => {
    const chain = createQueryChain()
    mockFrom.mockReturnValue(chain)

    await listClaimRequests('pending', { limit: 5 })

    expect(mockFrom).toHaveBeenCalledWith('claim_requests')
    expect(chain.select).toHaveBeenCalledWith(expect.stringContaining('brands(name, slug)'))
    expect(chain.eq).toHaveBeenCalledWith('status', 'pending')
    expect(chain.order).toHaveBeenCalledWith('created_at', { ascending: false })
    expect(chain.limit).toHaveBeenCalledWith(5)
  })

  it('applies limit to getFeedbackItems when provided', async () => {
    const chain = createQueryChain()
    mockFrom.mockReturnValue(chain)

    await getFeedbackItems({ status: 'open', limit: 5 })

    expect(mockFrom).toHaveBeenCalledWith('feedback')
    expect(chain.select).toHaveBeenCalledWith('*')
    expect(chain.eq).toHaveBeenCalledWith('status', 'open')
    expect(chain.order).toHaveBeenCalledWith('created_at', { ascending: false })
    expect(chain.limit).toHaveBeenCalledWith(5)
  })
})
