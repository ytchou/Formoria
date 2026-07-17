import { test, expect } from '../fixtures/auth'
import { seedBrand } from '../helpers/seed'

/**
 * Dashboard Analytics
 *
 * Journey: Brand owner navigates to /dashboard/brands/<slug>/analytics and
 * sees all analytics UI components in their empty-state form (new brand with
 * no view/click data yet).
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

  test('renders analytics page with empty-state components', async ({ userPage }) => {
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

    const mainContent = userPage.locator('#main-content')
    await expect(userPage.getByRole('heading', { name: '瀏覽與點擊' })).toBeVisible({
      timeout: 30_000,
    })
    // pageViews and outboundClicks are <p> labels in DataCard, not headings
    await expect(mainContent.getByText('頁面瀏覽', { exact: true })).toBeVisible({
      timeout: 10_000,
    })
    await expect(mainContent.getByText('外部連結點擊', { exact: true })).toBeVisible({
      timeout: 10_000,
    })

    await expect(
      userPage.getByRole('heading', { name: '流量來源' }),
    ).toBeVisible({ timeout: 10_000 })
    await expect(mainContent.getByText('尚無流量資料', { exact: true })).toBeVisible({
      timeout: 10_000,
    })

    await expect(mainContent.getByText('趨勢', { exact: true })).toBeVisible({
      timeout: 10_000,
    })
    await expect(
      userPage.getByRole('heading', { name: '各連結點擊數' }),
    ).toBeVisible({ timeout: 10_000 })
    await expect(mainContent.getByText('尚無連結點擊', { exact: true })).toBeVisible({
      timeout: 10_000,
    })
  })
})
