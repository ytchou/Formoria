/* eslint-disable react-hooks/rules-of-hooks */
import path from 'node:path'
import type { Page } from '@playwright/test'
import { test as baseTest, expect } from '../fixtures/auth'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { writeAuthStorageStateForCredentials } from '../helpers/auth-session'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>

/**
 * Dashboard — Quick Actions
 *
 * Journey: A brand owner visits their dashboard overview and sees the
 * QuickActions section with 4 action links (edit profile, check health,
 * view analytics, read FAQ).
 *
 * Actor: isolatedUser (throwaway account).
 * Seed: one approved brand owned by the isolated user.
 * Cleanup: afterAll deletes brand_owners row + brand.
 */
const test = baseTest.extend<{ userPage: Page }>({
  userPage: async ({ browser, isolatedUser }, use, testInfo) => {
    const storagePath = path.join(testInfo.outputDir, 'isolated-owner.json')
    await writeAuthStorageStateForCredentials(
      isolatedUser.email,
      isolatedUser.password,
      storagePath,
      'isolated-owner',
    )
    const context = await browser.newContext({ storageState: storagePath })
    const page = await context.newPage()
    await use(page)
    await context.close()
  },
})

test.describe.configure({ mode: 'serial' })

let supabase: AnySupabaseClient
let brandId: string
let brandSlug: string

test.beforeAll(async ({ isolatedUser }) => {
  supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const ts = Date.now()
  brandSlug = `e2e-quick-actions-${ts}`
  const brandName = `[E2E-TEST] Quick Actions ${ts}`

  const { data: brand, error } = await supabase
    .from('brands')
    .insert({
      name: brandName,
      slug: brandSlug,
      status: 'approved',
      product_type: 'crafts',
      description: '[E2E-TEST] Quick actions fixture.',
      retail_locations: [],
    })
    .select('id')
    .single()

  if (error || !brand) throw new Error(`Failed to seed brand: ${error?.message}`)
  brandId = brand.id

  const { error: ownerError } = await supabase
    .from('brand_owners')
    .insert({ user_id: isolatedUser.id, brand_id: brandId })

  if (ownerError) throw new Error(`Failed to set brand ownership: ${ownerError.message}`)
})

test.afterAll(async () => {
  if (!supabase || !brandId) return
  // brand_owners cascades on brand delete; be explicit for clarity.
  await supabase.from('brand_owners').delete().eq('brand_id', brandId)
  await supabase.from('brands').delete().eq('id', brandId)
})

test.describe('Dashboard — quick actions', () => {
  test('quick actions section visible with 4 action links', async ({ userPage }) => {
    test.setTimeout(120_000)

    const resp = await userPage.goto(`/dashboard/brands/${brandSlug}`, { timeout: 60_000 })
    if (resp?.status() === 503) {
      test.skip(true, 'PREVIEW_MODE active — skipping')
      return
    }

    // Brand profile wrapper must be present.
    await expect(userPage.locator('[data-testid="brand-profile"]')).toBeVisible({
      timeout: 30_000,
    })

    // Assert all 4 quick action links with their expected hrefs.
    await expect(userPage.getByRole('link', { name: '編輯品牌資料' })).toHaveAttribute(
      'href',
      `/dashboard/brands/${brandSlug}/edit`,
    )
    await expect(userPage.getByRole('link', { name: '檢查品牌健康度' })).toHaveAttribute(
      'href',
      '#profile-completeness',
    )
    await expect(userPage.getByRole('link', { name: '查看分析數據' })).toHaveAttribute(
      'href',
      `/dashboard/brands/${brandSlug}/analytics`,
    )
    await expect(userPage.getByRole('link', { name: '閱讀品牌主常見問題' })).toHaveAttribute(
      'href',
      '/faq#for-owners',
    )
  })
})
