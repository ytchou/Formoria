import { test, expect } from '../fixtures/auth'
import { seedBrand } from '../helpers/seed'

/**
 * Dashboard Analytics
 *
 * Journey: Brand owner navigates to /dashboard/brands/<slug>/analytics and
 * sees the PostHog session dashboard or its explicit provider-unavailable
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

  test('renders authorized PostHog session analytics with an explicit provider state', async ({ userPage }) => {
    test.setTimeout(60_000)

    const resp = await userPage.goto(
      `/dashboard/brands/${brandSlug}/analytics`,
      {
        timeout: 60_000,
      },
    )
    if (resp?.status() === 503) {
      test.skip(true, 'PREVIEW_MODE active — skipping')
      return
    }

    const available = userPage.getByText(/^(Profile sessions|品牌頁工作階段)$/)
    const unavailable = userPage.getByRole('heading', { name: /^(Analytics temporarily unavailable|數據分析暫時無法使用)$/ })
    await expect(available.or(unavailable)).toBeVisible({ timeout: 30_000 })

    if (await available.isVisible()) {
      await expect(userPage.getByText(/^(Outbound sessions|外連工作階段)$/)).toBeVisible()
      await expect(userPage.getByText(/^(Outbound conversion|外連轉換率)$/)).toBeVisible()
      await expect(userPage.getByRole('heading', { name: /^(30-day session trend|30 天工作階段趨勢)$/ })).toBeVisible()
      await expect(userPage.getByRole('heading', { name: /^(Acquisition sources|流量來源)$/ })).toBeVisible()
      await expect(userPage.getByRole('heading', { name: /^(Outbound destinations|外連目的地)$/ })).toBeVisible()
      await expect(userPage.getByRole('link', { name: /^(Open in PostHog|在 PostHog 開啟)$/ })).toHaveAttribute('href', /^https:\/\//)
      await expect(userPage.getByText(/^(Source|資料來源) · PostHog$/)).toBeVisible()
    } else {
      await expect(userPage.getByText(/PostHog.*(could not load|目前無法載入)/)).toBeVisible()
    }
  })
})
