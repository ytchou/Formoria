import { test, expect } from '../fixtures/auth'
import { seedBrand } from '../helpers/seed'

/**
 * Dashboard Verification (MIT status)
 *
 * Journey: Brand owner navigates to /dashboard/verification?brand=<slug> and
 * sees the MitStatusCard with an unverified status badge, a cert number input,
 * and a verify button — all visible before any interaction.
 *
 * Actor: userPage (authenticated)
 * Seed: one brand owned by the E2E user, status approved, no mitEvidence
 * Cleanup: afterAll via seedBrand cleanup()
 */
test.describe('Dashboard — MIT verification', () => {
  let brandSlug: string
  let cleanup: () => Promise<void>

  test.beforeAll(async ({}, workerInfo) => {
    const result = await seedBrand({
      name: 'verification',
      workerIndex: workerInfo.workerIndex,
      withOwner: true,
    })
    brandSlug = result.slug
    cleanup = result.cleanup
  })

  test.afterAll(async () => {
    await cleanup?.()
  })

  test('renders MIT verification page with unverified status', async ({ userPage }) => {
    test.setTimeout(60_000)

    const resp = await userPage.goto(`/dashboard/verification?brand=${brandSlug}`, {
      timeout: 60_000,
    })
    if (resp?.status() === 503) {
      test.skip(true, 'PREVIEW_MODE active — skipping')
      return
    }

    await expect(
      userPage.getByRole('heading', { name: 'MIT 驗證狀態' }),
    ).toBeVisible({ timeout: 30_000 })

    await expect(userPage.getByText('尚未驗證', { exact: true })).toBeVisible({
      timeout: 10_000,
    })
    await expect(
      userPage.getByText(
        '您可以來信申請 MIT 微笑標章驗證，讓消費者更容易找到您的品牌。',
        { exact: true },
      ),
    ).toBeVisible({ timeout: 10_000 })

    await expect(userPage.getByLabel('MIT 微笑標章編號')).toBeVisible({
      timeout: 10_000,
    })
    await expect(userPage.getByPlaceholder('例如 01900539-00001')).toBeVisible({
      timeout: 10_000,
    })

    await expect(userPage.getByRole('button', { name: '驗證' })).toBeVisible({
      timeout: 10_000,
    })
  })
})
