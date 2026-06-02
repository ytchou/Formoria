import { describe, it, expect, vi } from 'vitest'

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(),
  setRequestLocale: vi.fn(),
}))

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
  permanentRedirect: vi.fn(),
  useRouter: vi.fn(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() })),
  usePathname: vi.fn(() => '/'),
  useSearchParams: vi.fn(() => new URLSearchParams()),
}))

import zh from '../../../../messages/zh-TW.json'
import { getTranslations } from 'next-intl/server'

type Messages = typeof zh

function makeT(messages: Messages, namespace: string) {
  return (key: string) => {
    const parts = `${namespace}.${key}`.split('.')
    let current: unknown = messages
    for (const part of parts) {
      if (typeof current !== 'object' || current === null) return key
      current = (current as Record<string, unknown>)[part]
    }
    return typeof current === 'string' ? current : key
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
vi.mocked(getTranslations).mockImplementation(async (namespace: any) => {
  const t = makeT(zh as Messages, typeof namespace === 'string' ? namespace : '')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return t as any
})

describe('SubmitPage', () => {
  it('exports a default async component', async () => {
    const { default: SubmitPage } = await import('./page')
    expect(typeof SubmitPage).toBe('function')
  })
})
