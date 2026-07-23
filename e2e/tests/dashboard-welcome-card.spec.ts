import path from 'node:path'
import type { Page } from '@playwright/test'
import { test as baseTest, expect } from '../fixtures/auth'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { writeAuthStorageStateForCredentials } from '../helpers/auth-session'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>

/**
 * Dashboard — Welcome Card
 *
 * Journey: A brand owner visits their dashboard for the first time, sees the
 * onboarding welcome card with 4 tip links, dismisses it, and confirms the
 * dismissal persists across a full page reload.
 *
 * Actor: isolatedUser (throwaway account) so onboarding_dismissed_at starts null.
 * Seed: one approved brand owned by the isolated user.
 * Cleanup: afterAll deletes brand_owners row + brand.
 *
 * Serial mode: the single test mutates state (dismiss), so we force serial to
 * prevent any future test additions from racing.
 */
// Override userPage to authenticate as the isolated throwaway owner.
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
  brandSlug = `e2e-welcome-card-${ts}`
  const brandName = `[E2E-TEST] Welcome Card ${ts}`

  const { data: brand, error } = await supabase
    .from('brands')
    .insert({
      name: brandName,
      slug: brandSlug,
      status: 'approved',
      product_type: 'crafts',
      description: '[E2E-TEST] Welcome card fixture.',
      retail_locations: [],
      // onboarding_dismissed_at intentionally omitted → stays null → card shows
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

test.describe('Dashboard — welcome card', () => {
  test('welcome card visible on fresh brand; dismissed state persists across reload', async ({
    userPage,
  }) => {
    test.setTimeout(120_000)

    const resp = await userPage.goto(`/dashboard/brands/${brandSlug}`, { timeout: 60_000 })
    if (resp?.status() === 503) {
      test.skip(true, 'PREVIEW_MODE active — skipping')
      return
    }

    // Welcome card must be visible: brand is fresh, onboarding_dismissed_at is null.
    // The <section aria-labelledby="welcome-banner-title"> gets implicit role=region.
    const welcomeCard = userPage.getByRole('region', { name: '歡迎來到您的品牌儀表板' })
    await expect(welcomeCard).toBeVisible({ timeout: 30_000 })

    // Assert all 4 tip links with their expected hrefs.
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

    // Dismiss: aria-label="關閉" (from dashboard.welcome.dismiss in zh-TW.json)
    await userPage.getByRole('button', { name: '關閉' }).click()

    // Server action (dismissWelcome) runs → revalidatePath → router refreshes.
    // The card should disappear without a manual reload.
    await expect(welcomeCard).not.toBeVisible({ timeout: 15_000 })

    // Explicit reload: confirm server has persisted onboarding_dismissed_at.
    // Use toPass to tolerate any brief ISR window on this protected page.
    await expect(async () => {
      await userPage.reload({ timeout: 30_000 })
      await expect(
        userPage.getByRole('region', { name: '歡迎來到您的品牌儀表板' }),
      ).not.toBeVisible({ timeout: 5_000 })
    }).toPass({ timeout: 30_000 })

    // Brand profile content must still be rendered after dismissal.
    await expect(userPage.locator('[data-testid="brand-profile"]')).toBeVisible({
      timeout: 10_000,
    })
  })
})
