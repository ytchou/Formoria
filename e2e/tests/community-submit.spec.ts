import { test, expect } from '../fixtures/auth'
import { createClient } from '@supabase/supabase-js'
import { gotoSubmitForm } from '../utils/submit-form'

test.describe('Community submit flow', () => {
  // Label text in zh-TW for owner checkbox and source attribution
  const ownerCheckboxLabel = '我是品牌負責人'
  const sourceLabelText = '資料來源'

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

  test('source attribution select is hidden when isOwner is checked (default)', async ({ userPage }) => {
    test.setTimeout(60_000)
    await gotoSubmitForm(userPage)
    // isOwner defaults to true — source attribution select must not be visible
    await expect(userPage.locator('#submit-source')).not.toBeVisible()
  })

  test('source attribution select appears when owner checkbox is unchecked', async ({ userPage }) => {
    test.setTimeout(60_000)
    await gotoSubmitForm(userPage)

    const ownerCheckbox = userPage.locator('#submit-is-owner')
    await expect(ownerCheckbox).toBeVisible({ timeout: 5_000 })

    // Uncheck the owner box — attribution select should now appear
    await ownerCheckbox.uncheck()
    await expect(userPage.locator('#submit-source')).toBeVisible({ timeout: 5_000 })

    // Re-check owner — attribution select must disappear again
    await ownerCheckbox.check()
    await expect(userPage.locator('#submit-source')).not.toBeVisible()
  })

  test('all required fields are visible immediately (single-screen flat form)', async ({ userPage }) => {
    test.setTimeout(60_000)
    await gotoSubmitForm(userPage)

    // Website URL, brand name, and region are all visible on the single screen
    await expect(userPage.locator('#submit-website')).toBeVisible({ timeout: 5_000 })
    await expect(userPage.locator('#submit-name')).toBeVisible({ timeout: 5_000 })
    await expect(userPage.locator('#submit-region')).toBeVisible({ timeout: 5_000 })

    // PDPA consent is on the same single screen
    await expect(userPage.locator('#submit-pdpa')).toBeVisible({ timeout: 3_000 })

    // No step indicator should exist in the simplified form
    await expect(userPage.locator('[data-state="active"]')).not.toBeVisible()
  })

  test('my-submissions page shows authenticated user submissions', async ({ userPage }) => {
    test.setTimeout(60_000)
    await userPage.goto('/my-submissions')
    await expect(userPage.getByRole('heading', { name: /經營者主控台/i, level: 1 }))
      .toBeVisible({ timeout: 15_000 })
  })

  test('my-submissions renders English copy under /en', async ({ userPage }) => {
    test.setTimeout(60_000)
    const res = await userPage.goto('/en/my-submissions')
    expect(res?.status()).toBeLessThan(400)
    await expect(userPage.getByRole('heading', { name: /Owner Dashboard|My Submissions|經營者主控台|我的提交/i }).first()).toBeVisible({
      timeout: 15_000,
    })
  })
})
