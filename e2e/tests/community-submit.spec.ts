import { test, expect } from '../fixtures/auth'
import { createClient } from '@supabase/supabase-js'
import { gotoSubmitOwner, gotoSubmitRecommend } from '../utils/submit-form'
import { OWNER_FEATURES_OFF_REASON } from '../helpers/owner-features'

test.describe('Community submit flow', () => {
  test.afterAll(async () => {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    await supabase.from('brand_submissions').delete().like('brand_name', '[E2E-COMMUNITY]%')
  })

  test('@smoke recommendation flow is available without owner-only controls', async ({ userPage }) => {
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

  test('@smoke owner quick form shows its core fields when owner features are enabled', async ({ userPage }) => {
    test.setTimeout(60_000)
    const probe = await userPage.goto('/submit/owner/quick', { timeout: 60_000 })
    if (probe?.status() === 404) {
      test.skip(true, OWNER_FEATURES_OFF_REASON)
      return
    }

    await gotoSubmitOwner(userPage)
    await expect(userPage.locator('#submit-name')).toBeVisible({ timeout: 5_000 })
    await expect(userPage.locator('#submit-website')).toBeVisible()
    await expect(userPage.locator('#submit-description')).toBeVisible()
  })

  // There is no submissions list page, and while owner features are gated off
  // (DEV-1261) there is no owner dashboard to fall back to either — so the
  // route hands a signed-in user the home page rather than a dead end.
  // zh-TW is the default locale and its prefix is stripped, so the zh-TW home
  // page is `/` and the English one is `/en`.
  const isHomePath = (pathname: string) => /^\/(?:en)?\/?$/.test(pathname)

  test('@smoke my-submissions redirects authenticated users to the home page', async ({ userPage }) => {
    test.setTimeout(60_000)
    await userPage.goto('/my-submissions')
    await userPage.waitForURL((url) => isHomePath(url.pathname), { timeout: 15_000 })
    expect(new URL(userPage.url()).pathname).not.toContain('/dashboard')
    await expect(userPage.locator('main, section').first()).toBeVisible({ timeout: 10_000 })
  })

  test('my-submissions /en redirects to the home page', async ({ userPage }) => {
    test.setTimeout(60_000)
    const res = await userPage.goto('/en/my-submissions')
    expect(res?.status()).toBeLessThan(400)
    await userPage.waitForURL((url) => isHomePath(url.pathname), { timeout: 15_000 })
    expect(new URL(userPage.url()).pathname).not.toContain('/dashboard')
    await expect(userPage.locator('main, section').first()).toBeVisible({ timeout: 10_000 })
  })
})
