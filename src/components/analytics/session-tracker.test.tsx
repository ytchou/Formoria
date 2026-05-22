// @vitest-environment jsdom
import { vi, describe, it, expect, beforeEach } from 'vitest'

const mockSendGAEvent = vi.fn()
vi.mock('@next/third-parties/google', () => ({
  sendGAEvent: (...args: unknown[]) => mockSendGAEvent(...args),
}))

import { render } from '@testing-library/react'
import { SessionTracker } from './session-tracker'

beforeEach(() => {
  mockSendGAEvent.mockClear()
  localStorage.clear()
})

describe('SessionTracker', () => {
  it('fires session_start with is_returning=false on first visit', () => {
    render(<SessionTracker />)
    expect(mockSendGAEvent).toHaveBeenCalledWith('event', 'session_start', {
      is_returning: false,
      days_since_last_visit: null,
    })
  })

  it('fires session_start with is_returning=true on repeat visit within 7 days', () => {
    const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000
    localStorage.setItem('mit_last_visit', String(threeDaysAgo))
    render(<SessionTracker />)
    expect(mockSendGAEvent).toHaveBeenCalledWith('event', 'session_start', {
      is_returning: true,
      days_since_last_visit: 3,
    })
  })

  it('fires session_start with is_returning=false after 7+ days', () => {
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000
    localStorage.setItem('mit_last_visit', String(eightDaysAgo))
    render(<SessionTracker />)
    expect(mockSendGAEvent).toHaveBeenCalledWith('event', 'session_start', {
      is_returning: false,
      days_since_last_visit: null,
    })
  })

  it('updates mit_last_visit in localStorage on every render', () => {
    render(<SessionTracker />)
    expect(localStorage.getItem('mit_last_visit')).toBeTruthy()
  })
})
