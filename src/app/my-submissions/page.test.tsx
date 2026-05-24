import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  createClient: () =>
    Promise.resolve({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1', email: 'test@example.com' } },
          error: null,
        }),
      },
    }),
}))

vi.mock('@/lib/services/submissions', () => ({
  getUserSubmissions: vi.fn().mockResolvedValue([
    {
      id: 'sub-1',
      brandName: 'Test Brand',
      status: 'pending',
      createdAt: '2026-05-25T00:00:00Z',
    },
  ]),
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}))

describe('MySubmissionsPage', () => {
  it('exports a default async component', async () => {
    const { default: MySubmissionsPage } = await import('./page')
    expect(typeof MySubmissionsPage).toBe('function')
  })

  it('renders submission list when user has submissions', async () => {
    const { default: MySubmissionsPage } = await import('./page')
    const element = await MySubmissionsPage()
    // Server Component returns a React element — check it's not null
    expect(element).not.toBeNull()
  })
})
