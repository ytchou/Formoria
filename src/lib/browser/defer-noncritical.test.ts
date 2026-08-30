// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { deferNoncritical } from './defer-noncritical'

describe('deferNoncritical', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps non-critical work out of the initial page load', () => {
    vi.useFakeTimers()
    const callback = vi.fn()

    deferNoncritical(callback)
    vi.advanceTimersByTime(9_999)
    expect(callback).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(callback).toHaveBeenCalledOnce()
  })

  it('runs at the first user interaction without waiting for the fallback', () => {
    vi.useFakeTimers()
    const callback = vi.fn()

    deferNoncritical(callback)
    window.dispatchEvent(new PointerEvent('pointerdown'))

    expect(callback).toHaveBeenCalledOnce()
    vi.runAllTimers()
    expect(callback).toHaveBeenCalledOnce()
  })
})
