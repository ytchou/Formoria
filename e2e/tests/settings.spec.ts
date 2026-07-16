import { test, expect } from '../fixtures/auth'

/**
 * User Settings
 *
 * Journey: Authenticated user navigates to /settings and sees the settings
 * form populated with their account data and all preference controls.
 *
 * Actor: userPage (authenticated)
 * Seed: none
 */
test.describe('Settings page', () => {
  test('renders settings form with user data', async ({ userPage }) => {
    test.setTimeout(60_000)

    const resp = await userPage.goto('/settings', { timeout: 60_000 })
    if (resp?.status() === 503) {
      test.skip(true, 'PREVIEW_MODE active — skipping')
      return
    }

    // Page heading (zh-TW: "帳號設定")
    await expect(
      userPage.getByRole('heading', { name: '帳號設定' }),
    ).toBeVisible({ timeout: 30_000 })

    // Email field (read-only, no id — located by label)
    const emailLabel = userPage.getByText('電子郵件', { exact: true })
    await expect(emailLabel).toBeVisible({ timeout: 10_000 })

    // Email field contains the test user's email address
    const emailInput = userPage.locator('input[readonly]').first()
    await expect(emailInput).toBeVisible({ timeout: 5_000 })
    await expect(emailInput).toHaveValue(process.env.E2E_USER_EMAIL ?? '', {
      timeout: 5_000,
    })

    // Display name field
    await expect(userPage.locator('#displayName')).toBeVisible({ timeout: 5_000 })

    // Locale preference select (options: zh-TW, en)
    const localeSelect = userPage.locator('#localePreference')
    await expect(localeSelect).toBeVisible({ timeout: 5_000 })

    // Independently managed marketing categories
    await expect(userPage.locator('#newsletterMarketing')).toBeVisible({ timeout: 5_000 })
    await expect(userPage.locator('#lifecycleMarketing')).toBeVisible({ timeout: 5_000 })
    await expect(
      userPage.getByRole('button', { name: '取消所有行銷電子郵件' }),
    ).toBeVisible({ timeout: 5_000 })
  })
})
