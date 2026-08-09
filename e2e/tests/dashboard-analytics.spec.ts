import { test, expect } from '../fixtures/auth'
import { seedBrand } from '../helpers/seed'
import { ownerFeaturesDisabled, OWNER_FEATURES_OFF_REASON } from '../helpers/owner-features'

import { BUDGET } from '../budgets'
// Suite-level gate (DEV-1261). Declared at file scope so it runs before the
// describe's seeding beforeAll: the owner analytics tab is unreachable while
// the flag is off. Probes the running app, never app_settings.
test.beforeAll(async ({ browser }) => {
  if (await ownerFeaturesDisabled(browser)) {
    test.skip(true, OWNER_FEATURES_OFF_REASON)
  }
})

/**
 * Dashboard Analytics
 *
 * Journey: Brand owner navigates to /dashboard/brands/<slug>/analytics and
 * sees the analytics dashboard or its explicit provider-unavailable
 * state. Ownership is seeded before the request reaches analytics.
 *
 * Actor: userPage (authenticated)
 * Seed: one brand owned by the E2E user
 * Cleanup: afterAll via seedBrand cleanup()
 */
test.describe('Dashboard — analytics', () => {
  let brandSlug: string
  let cleanup: () => Promise<void>

  test.beforeAll(async ({}, workerInfo) => {
    const result = await seedBrand({
      name: 'analytics',
      workerIndex: workerInfo.workerIndex,
      withOwner: true,
    })
    brandSlug = result.slug
    cleanup = result.cleanup
  })

  test.afterAll(async () => {
    await cleanup?.()
  })

  test('renders authorized analytics with an explicit provider state', async ({ userPage }) => {
    test.setTimeout(BUDGET.TEST.JOURNEY);
    const resp = await userPage.goto(
      `/dashboard/brands/${brandSlug}/analytics`,
      {
      },
    )
    if (resp?.status() === 503) {
      test.skip(true, 'PREVIEW_MODE active — skipping')
      return
    }

    const available = userPage.getByText(/^(Profile visits|品牌頁瀏覽)$/)
    const unavailable = userPage.getByRole('heading', { name: /^(Analytics temporarily unavailable|數據分析暫時無法使用)$/ })
    await expect(available.or(unavailable)).toBeVisible({ timeout: 30_000 })

    if (await available.isVisible()) {
      await expect(userPage.getByText(/^(Outbound clicks|外部連結點擊)$/)).toBeVisible()
      await expect(userPage.getByText(/^(Outbound click rate|外連點擊率)$/)).toBeVisible()
      await expect(userPage.getByText(/^(Top traffic source|主要流量來源)$/)).toBeVisible()
      await expect(userPage.getByText(/^(30-day traffic trend|30 天流量趨勢)$/)).toBeVisible()
      await expect(userPage.getByText(/^(Traffic sources|流量來源)$/)).toBeVisible()
      await expect(userPage.getByText(/^(Outbound destinations|外連目的地)$/)).toBeVisible()
    } else {
      await expect(userPage.getByText(/Analytics.*(could not load|目前無法載入)/)).toBeVisible()
    }
  })
})
