// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import zh from '../../../../../../messages/zh-TW.json'

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(),
  setRequestLocale: vi.fn(),
}))

vi.mock('@/i18n/navigation', () => ({
  Link: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'user-1', email: 'test@example.com' } },
        error: null,
      }),
    },
  }),
}))

vi.mock('@/lib/services/brand-owners', () => ({
  getUserBrands: vi.fn(),
}))

vi.mock('@/lib/services/submissions', () => ({
  getUserSubmissions: vi.fn(),
}))

vi.mock('@/lib/services/saved-brands', () => ({
  getUserSavedBrands: vi.fn(),
}))

vi.mock('@/lib/services/profiles', () => ({
  getProfile: vi.fn(),
}))

vi.mock('@/components/dashboard/brand-management-panel', () => ({
  BrandManagementPanel: ({ slug }: { slug: string }) => (
    <div>Brand management panel: {slug}</div>
  ),
}))

import { getTranslations } from 'next-intl/server'
import { getUserBrands } from '@/lib/services/brand-owners'
import { getUserSubmissions } from '@/lib/services/submissions'
import { getUserSavedBrands } from '@/lib/services/saved-brands'
import { getProfile } from '@/lib/services/profiles'
import DashboardPage from '../page'

type Messages = typeof zh

function makeT(messages: Messages, namespace: string) {
  return (key: string, values?: Record<string, unknown>) => {
    const parts = `${namespace}.${key}`.split('.')
    let current: unknown = messages
    for (const part of parts) {
      if (typeof current !== 'object' || current === null) return key
      current = (current as Record<string, unknown>)[part]
    }

    const message = typeof current === 'string' ? current : key
    if (!values) return message

    return message.replace(/\{(\w+)\}/g, (_match, name: string) =>
      String(values[name] ?? `{${name}}`)
    )
  }
}

async function renderDashboard(searchParams: { error?: string; tab?: string } = {}) {
  return render(
    await DashboardPage({
      params: Promise.resolve({ locale: 'zh-TW' }),
      searchParams: Promise.resolve(searchParams),
    })
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getTranslations).mockImplementation(async (namespace) => {
    const t = makeT(zh as Messages, typeof namespace === 'string' ? namespace : '')
    return t as Awaited<ReturnType<typeof getTranslations>>
  })
  vi.mocked(getUserBrands).mockResolvedValue([])
  vi.mocked(getUserSubmissions).mockResolvedValue([])
  vi.mocked(getUserSavedBrands).mockResolvedValue([])
  vi.mocked(getProfile).mockResolvedValue(null)
})

describe('saved brands tab', () => {
  it('renders saved brands tab when user has saved brands', async () => {
    vi.mocked(getUserSavedBrands).mockResolvedValue([
      {
        brandId: 'brand-1',
        brandName: '收藏品牌一',
        brandSlug: 'saved-brand-one',
        heroImageUrl: null,
        savedAt: '2026-06-01T00:00:00Z',
      },
    ])

    await renderDashboard()

    expect(await screen.findByRole('link', { name: '收藏品牌' })).toBeInTheDocument()
  })

  it('does not render saved tab when user has no saves and tab param is not saved', async () => {
    vi.mocked(getUserSavedBrands).mockResolvedValue([])

    await renderDashboard()

    expect(screen.queryByRole('link', { name: '收藏品牌' })).not.toBeInTheDocument()
  })

  it('shows empty state when saved tab is active but no saves exist', async () => {
    vi.mocked(getUserSavedBrands).mockResolvedValue([])

    await renderDashboard({ tab: 'saved' })

    expect(await screen.findByText('還沒有收藏品牌')).toBeInTheDocument()
    expect(screen.getByText('去探索品牌目錄吧！')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '探索品牌目錄' })).toHaveAttribute(
      'href',
      '/brands'
    )
  })
})
