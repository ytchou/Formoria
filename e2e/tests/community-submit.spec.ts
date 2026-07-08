import { test, expect } from '../fixtures/auth'
import { createClient } from '@supabase/supabase-js'
import { gotoSubmitRecommend } from '../utils/submit-form'

test.describe('Community submit flow', () => {
  test.afterAll(async () => {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    await supabase.from('brand_submissions').delete().like('brand_name', '[E2E-COMMUNITY]%')
  })

  test('recommendation flow is available without owner-only controls', async ({ userPage }) => {
    test.setTimeout(60_000)
    await gotoSubmitRecommend(userPage)
    await expect(userPage.locator('#submit-source')).toBeVisible({ timeout: 5_000 })
    await expect(userPage.locator('#submit-guest-email')).toBeVisible({ timeout: 5_000 })
    await expect(userPage.locator('#submit-instagram')).toHaveCount(0)
  })

  test('source attribution select is visible on the recommendation form', async ({ userPage }) => {
    test.setTimeout(60_000)
    await gotoSubmitRecommend(userPage)
    await expect(userPage.locator('#submit-source')).toBeVisible({ timeout: 5_000 })
  })

  test('recommendation required fields are visible immediately', async ({ userPage }) => {
    test.setTimeout(60_000)
    await gotoSubmitRecommend(userPage)
    await expect(userPage.locator('#submit-website')).toBeVisible({ timeout: 5_000 })
    await expect(userPage.locator('#submit-name')).toBeVisible({ timeout: 5_000 })
    await expect(userPage.locator('#submit-pdpa')).toBeVisible({ timeout: 3_000 })
    await expect(userPage.locator('[data-state="active"]')).not.toBeVisible()
  })

  test('my-submissions redirects authenticated users to /dashboard', async ({ userPage }) => {
    // /my-submissions now server-redirects to /dashboard (no submissions list page).
    test.setTimeout(60_000)
    await userPage.goto('/my-submissions')
    await userPage.waitForURL(/\/dashboard/, { timeout: 15_000 })
    // Dashboard renders: brand panel uses <main>; empty state (no brands) uses <section>.
    await expect(userPage.locator('main, section').first()).toBeVisible({ timeout: 5_000 })
  })

  test('my-submissions /en redirects to /dashboard', async ({ userPage }) => {
    // /en/my-submissions also server-redirects to /dashboard.
    test.setTimeout(60_000)
    const res = await userPage.goto('/en/my-submissions')
    expect(res?.status()).toBeLessThan(400)
    await userPage.waitForURL(/\/dashboard/, { timeout: 15_000 })
    // Dashboard renders: brand panel uses <main>; empty state (no brands) uses <section>.
    await expect(userPage.locator('main, section').first()).toBeVisible({ timeout: 5_000 })
  })
})
