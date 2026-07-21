// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ identify: vi.fn(), reset: vi.fn(), useUser: vi.fn() }))

vi.mock('@/lib/analytics/posthog-provider', () => ({
  identifyPostHogUser: mocks.identify,
  resetPostHogUser: mocks.reset,
}))
vi.mock('@/lib/auth/use-user', () => ({ useUser: mocks.useUser }))

import { PostHogUserSync } from './posthog-user-sync'

describe('PostHogUserSync', () => {
  beforeEach(() => vi.clearAllMocks())

  it('identifies only by stable Supabase UUID and resets on logout', () => {
    mocks.useUser.mockReturnValue({ user: { id: 'user-uuid', email: 'private@example.com', provider: 'google' } })
    const view = render(<PostHogUserSync />)

    expect(mocks.identify).toHaveBeenCalledWith('user-uuid', { is_internal: false })
    expect(JSON.stringify(mocks.identify.mock.calls)).not.toContain('private@example.com')

    mocks.useUser.mockReturnValue({ user: null })
    view.rerender(<PostHogUserSync />)
    expect(mocks.reset).toHaveBeenCalledOnce()
  })

  it('flags internal team accounts without sending the email', () => {
    mocks.useUser.mockReturnValue({ user: { id: 'team-uuid', email: 'Patrick.Ytchou@gmail.com', provider: 'google' } })
    render(<PostHogUserSync />)

    expect(mocks.identify).toHaveBeenCalledWith('team-uuid', { is_internal: true })
    expect(JSON.stringify(mocks.identify.mock.calls)).not.toContain('gmail.com')
  })
})
