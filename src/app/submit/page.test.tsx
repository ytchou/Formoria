import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'user-123', email: 'test@example.com' } },
        error: null,
      }),
    },
  }),
}))

vi.mock('@/lib/services/taxonomy', () => ({
  getTags: vi.fn().mockResolvedValue([
    {
      id: '1',
      slug: 'fashion',
      name: 'Fashion',
      nameZh: '時尚',
      category: 'product_type',
      isActive: true,
      suggestedBy: null,
      createdAt: '2026-01-01',
    },
  ]),
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}))

describe('SubmitPage', () => {
  it('exports a default async component', async () => {
    const { default: SubmitPage } = await import('./page')
    expect(typeof SubmitPage).toBe('function')
  })
})
