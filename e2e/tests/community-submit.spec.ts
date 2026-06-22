import { test, expect } from '../fixtures/auth'
import { createClient } from '@supabase/supabase-js'
import { gotoSubmitWizard } from '../utils/submit-wizard'

test.describe('Community submit flow', () => {
  const ownerCheckboxName = '我是品牌所有者'
  const attributionLabelName = '你如何認識這個品牌？'
  const skipButtonName = '跳過，手動填寫'

  test.afterAll(async () => {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    await supabase.from('brand_submissions').delete().like('brand_name', '[E2E-COMMUNITY]%')
  })

  test('community submitter sees owner checkbox on URL step', async ({ userPage }) => {
    test.setTimeout(60_000)
    await gotoSubmitWizard(userPage)
    // UrlStep renders the owner checkbox without needing to fill in anything
    await expect(userPage.getByRole('checkbox', { name: ownerCheckboxName, exact: true }))
      .toBeVisible({ timeout: 5_000 })
  })

  test('source attribution dropdown appears when owner unchecked', async ({ userPage }) => {
    test.setTimeout(60_000)
    await gotoSubmitWizard(userPage)
    const ownerCheckbox = userPage.getByRole('checkbox', { name: ownerCheckboxName, exact: true })
    // isOwner defaults to false — attribution select is visible immediately on URL step
    await expect(userPage.getByRole('combobox', { name: attributionLabelName, exact: true }))
      .toBeVisible({ timeout: 5_000 })
    await ownerCheckbox.check()
    await expect(userPage.getByRole('combobox', { name: attributionLabelName, exact: true }))
      .not.toBeVisible()
  })

  test('community submitter skips URL step and sees single-screen brand form', async ({ userPage }) => {
    test.setTimeout(60_000)
    await gotoSubmitWizard(userPage)

    await userPage.getByRole('button', { name: skipButtonName, exact: true }).click()

    // Single-screen form — no step indicator, brand name field is present
    await expect(userPage.locator('#brand-name')).toBeVisible({ timeout: 5_000 })

    // PDPA consent is on the same single screen (visible by associated label text)
    await expect(userPage.getByText(/我同意依據/)).toBeVisible({ timeout: 3_000 })

    // Region select is present
    await expect(userPage.locator('#brand-region')).toBeVisible({ timeout: 3_000 })

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
