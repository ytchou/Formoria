// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ImpersonationBanner } from './impersonation-banner'

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  refreshViewer: vi.fn(),
}))

let expiresAt = 0

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: mocks.refresh,
  }),
}))

vi.mock('@/lib/actions/impersonation', () => ({
  endImpersonationAction: vi.fn(),
}))

vi.mock('next-intl', () => ({
  useTranslations: () => Object.assign(
    (key: string, params?: { brandName?: string }) =>
      key === 'banner' ? `You are viewing as ${params?.brandName}` : 'Exit',
    { raw: () => '{minutes}m remaining' },
  ),
}))

vi.mock('@/lib/auth/use-user', () => ({
  useUser: () => ({
    viewerLoading: false,
    viewer: {
      hasOwnedBrand: false,
      isAdmin: true,
      impersonation: {
        brandName: 'Warmwood Living',
        expiresAt,
      },
    },
    refreshViewer: mocks.refreshViewer,
  }),
}))

describe('ImpersonationBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.refreshViewer.mockResolvedValue(undefined)
    expiresAt = Math.floor(Date.now() / 1000) + 60
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders the remaining minutes on first paint', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-08T00:00:00Z'))

    expiresAt = Math.floor(Date.now() / 1000) + 60
    render(<ImpersonationBanner />)

    expect(screen.getByText('0m remaining')).toBeInTheDocument()
  })

  it('refreshes viewer state when impersonation expires', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-08T00:00:00Z'))
    expiresAt = Math.floor(Date.now() / 1000) + 1

    render(<ImpersonationBanner />)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })

    expect(mocks.refreshViewer).toHaveBeenCalledTimes(1)
  })
})
