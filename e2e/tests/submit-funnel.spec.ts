import { test, expect } from '../fixtures/auth'
import { createClient } from '@supabase/supabase-js'

/**
 * Submit Funnel End-to-End
 *
 * Journey: Authenticated user navigates to /submit/form, fills all required
 * fields, waits for Turnstile to auto-complete in dev mode, submits the form,
 * and lands on the /submit/confirmation page.
 *
 * Actor: userPage (authenticated)
 * Seed: none — creates a brand_submissions row on submit
 * Cleanup: afterAll deletes brand_submissions rows matching [E2E-TEST] Submit Funnel%
 *
 * Turnstile: In dev/test mode, window.turnstile is overridden via addInitScript
 * to immediately fire onSuccess before React mounts, so the submit button is
 * enabled as soon as all other fields are valid.
 */
test.describe('Submit funnel', () => {
  test.afterAll(async () => {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
    await supabase
      .from('brand_submissions')
      .delete()
      .like('brand_name', '[E2E-TEST] Submit Funnel%')
  })

  test('submits brand and reaches confirmation page', async ({ userPage }, workerInfo) => {
    test.setTimeout(60_000)

    const ts = Date.now()
    const wi = workerInfo.workerIndex
    const brandName = `[E2E-TEST] Submit Funnel ${ts}-${wi}`
    const websiteUrl = `https://e2e-submit-${ts}-${wi}.example.com`

    // Override window.turnstile BEFORE navigating so the widget immediately
    // calls onSuccess with a fake token.  addInitScript persists for all
    // subsequent navigations on this page instance.
    await userPage.addInitScript(() => {
      Object.defineProperty(window, 'turnstile', {
        configurable: true,
        get() {
          return {
            render(_el: HTMLElement, opts: { callback: (t: string) => void }) {
              setTimeout(() => opts.callback('e2e-bypass-token'), 50)
              return 'fake-widget-id'
            },
            remove() {},
          }
        },
      })
    })

    // Navigate with PREVIEW_MODE guard
    const resp = await userPage.goto('/submit/form', { timeout: 60_000 })
    if (resp?.status() === 503) {
      test.skip(true, 'PREVIEW_MODE active — skipping')
      return
    }

    // Auth-redirect resilience: middleware can transiently send to /auth/sign-in
    if (userPage.url().includes('/auth/sign-in')) {
      await userPage.goto('/submit/form', { timeout: 60_000 })
    }

    // Wait for the flat-form heading (confirms hydration)
    await expect(
      userPage.getByRole('heading', { name: '提交品牌', exact: true }),
    ).toBeVisible({ timeout: 30_000 })

    // Fill required fields
    await userPage.locator('#submit-website').fill(websiteUrl)
    await userPage.locator('#submit-name').fill(brandName)

    // Source attribution is required when isOwner is unchecked (default)
    await userPage.locator('#submit-source').selectOption('found_online')

    // PDPA consent
    await userPage.locator('#submit-pdpa').check()

    // Wait for submit button to be enabled (Turnstile fires via addInitScript mock).
    // Fallback: if not enabled within 15s, post a synthetic Cloudflare postMessage.
    const submitBtn = userPage.getByRole('button', { name: '提交品牌' })
    try {
      await expect(submitBtn).toBeEnabled({ timeout: 15_000 })
    } catch {
      await userPage.evaluate(() => {
        // Synthetic Cloudflare Turnstile success message (last-resort fallback)
        window.dispatchEvent(
          new MessageEvent('message', {
            data: JSON.stringify({ event: 'turnstile-callback', token: 'e2e-fallback-token' }),
            origin: 'https://challenges.cloudflare.com',
          }),
        )
      })
      await userPage.waitForTimeout(500)
    }

    await submitBtn.click()

    // Must land on the confirmation page
    await userPage.waitForURL(/\/submit\/confirmation/, { timeout: 30_000 })

    // Confirmation heading
    await expect(
      userPage.getByRole('heading', { name: '我們已收到您的品牌提交' }),
    ).toBeVisible({ timeout: 15_000 })

    // Both CTAs: return home and submit another
    await expect(userPage.locator('a[href="/"]').first()).toBeVisible()
    await expect(userPage.locator('a[href="/submit"]').first()).toBeVisible()

    // Verify brand_submissions row was created in DB
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
    const { data, error } = await supabase
      .from('brand_submissions')
      .select('id')
      .like('brand_name', '[E2E-TEST] Submit Funnel%')

    expect(error).toBeNull()
    expect(data?.length).toBeGreaterThanOrEqual(1)
  })
})
