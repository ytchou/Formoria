// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ opened: vi.fn(), step: vi.fn(), abandoned: vi.fn() }))
vi.mock('@/lib/analytics', () => ({
  trackSubmissionFormOpened: mocks.opened,
  trackSubmissionFormStepCompleted: mocks.step,
  trackSubmissionFormAbandoned: mocks.abandoned,
}))

import { useSubmissionAnalytics } from './use-submission-analytics'

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('useSubmissionAnalytics', () => {
  it('tracks approved lifecycle metadata and abandonment without form values', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-20T00:00:00.000Z'))
    const hook = renderHook(() => useSubmissionAnalytics('hero_cta', 'owner_claim', 'opened'))

    act(() => hook.result.current.stepCompleted('basicInfo'))
    vi.setSystemTime(new Date('2026-07-20T00:00:05.000Z'))
    hook.unmount()
    act(() => vi.runAllTimers())

    expect(mocks.opened).toHaveBeenCalledWith('hero_cta', 'owner_claim')
    expect(mocks.step).toHaveBeenCalledWith('basicInfo')
    expect(mocks.abandoned).toHaveBeenCalledWith('basicInfo', 5)
  })

  it('does not track abandonment after completion', () => {
    vi.useFakeTimers()
    const hook = renderHook(() => useSubmissionAnalytics('quick', 'owner', 'opened'))
    act(() => { hook.result.current.complete() })
    hook.unmount()
    act(() => vi.runAllTimers())

    expect(mocks.abandoned).not.toHaveBeenCalled()
  })
})
