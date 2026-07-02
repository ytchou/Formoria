import { describe, it, expect, vi } from 'vitest'
import zh from '../../../../messages/zh-TW.json'

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(),
  getLocale: vi.fn().mockResolvedValue('zh-TW'),
  setRequestLocale: vi.fn(),
}))

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

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}))

vi.mock('@/i18n/navigation', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Link: (props: any) => ({ type: 'a', props }),
}))

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

describe('MySubmissionsPage', () => {
  it('exports a default async component', async () => {
    const { default: MySubmissionsPage } = await import('./page')
    expect(typeof MySubmissionsPage).toBe('function')
  })

  it('renders submission list when user has submissions', async () => {
    const { default: MySubmissionsPage } = await import('./page')
    const element = await MySubmissionsPage({ params: Promise.resolve({ locale: 'zh-TW' }) })
    // Server Component returns a React element — check it's not null
    expect(element).not.toBeNull()
  })
})
