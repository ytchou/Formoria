import { test, expect } from '../fixtures/auth'
import { createClient } from '@supabase/supabase-js'
import { gotoSubmitForm } from '../utils/submit-form'

test.describe('Community submit flow', () => {
  // Label text in zh-TW for owner checkbox
  const ownerCheckboxLabel = '我是品牌負責人'

  test.afterAll(async () => {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    await supabase.from('brand_submissions').delete().like('brand_name', '[E2E-COMMUNITY]%')
  })

  test('owner checkbox is visible immediately on the flat form', async ({ userPage }) => {
    test.setTimeout(60_000)
    await gotoSubmitForm(userPage)
    // Flat form: owner checkbox is on the main screen, visible without any wizard step
    await expect(userPage.locator('#submit-is-owner'))
      .toBeVisible({ timeout: 5_000 })
    await expect(userPage.getByLabel(ownerCheckboxLabel))
      .toBeVisible({ timeout: 5_000 })
  })

  test('source attribution select is always visible on the flat form', async ({ userPage }) => {
    test.setTimeout(60_000)
    await gotoSubmitForm(userPage)
    await expect(userPage.locator('#submit-source')).toBeVisible({ timeout: 5_000 })
  })

  test('all required fields are visible immediately (single-screen flat form)', async ({ userPage }) => {
    test.setTimeout(60_000)
    await gotoSubmitForm(userPage)

    // Website URL and brand name are all visible on the single screen
    await expect(userPage.locator('#submit-website')).toBeVisible({ timeout: 5_000 })
    await expect(userPage.locator('#submit-name')).toBeVisible({ timeout: 5_000 })

    // PDPA consent is on the same single screen
    await expect(userPage.locator('#submit-pdpa')).toBeVisible({ timeout: 3_000 })

    // No step indicator should exist in the simplified form
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
