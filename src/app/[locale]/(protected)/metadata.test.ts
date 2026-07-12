import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
  setRequestLocale: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/services/resolve-dashboard-brand', () => ({
  resolveDashboardBrand: vi.fn(),
}))
vi.mock('@/lib/services/profiles', () => ({ getProfile: vi.fn() }))
vi.mock('@/components/settings/settings-form', () => ({ SettingsForm: () => null }))

import { generateMetadata as dashboardMetadata } from './dashboard/page'
import { generateMetadata as settingsMetadata } from './settings/page'

describe('protected page metadata', () => {
  it('marks dashboard and settings as noindex while allowing link following', async () => {
    const params = Promise.resolve({ locale: 'en' })
    const metadata = await Promise.all([
      dashboardMetadata({ params }),
      settingsMetadata({
        params,
        searchParams: Promise.resolve({}),
      }),
    ])

    for (const pageMetadata of metadata) {
      expect(pageMetadata.robots).toEqual({ index: false, follow: true })
    }
  })
})
