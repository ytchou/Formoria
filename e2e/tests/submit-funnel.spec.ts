import { test, expect } from '../fixtures/auth'
import { createClient } from '@supabase/supabase-js'

/**
 * Submit Funnel End-to-End
 *
 * Journey: Guest user navigates to /submit/recommend, fills all required
 * fields, waits for Turnstile to auto-complete in dev mode, submits the form,
 * and lands on the /submit/confirmation page.
 *
 * Actor: anonPage (guest)
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

  test('submits brand and reaches confirmation page', async ({ anonPage }, workerInfo) => {
    test.setTimeout(60_000)

    const ts = Date.now()
    const wi = workerInfo.workerIndex
    const brandName = `[E2E-TEST] Submit Funnel ${ts}-${wi}`
    const websiteUrl = `https://e2e-submit-${ts}-${wi}.example.com`

    // Override window.turnstile BEFORE navigating so the widget immediately
    // calls onSuccess with a fake token.  addInitScript persists for all
    // subsequent navigations on this page instance.
    await anonPage.addInitScript(() => {
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
    const resp = await anonPage.goto('/submit/recommend', { timeout: 60_000 })
    if (resp?.status() === 503) {
      test.skip(true, 'PREVIEW_MODE active — skipping')
      return
    }

    // Auth-redirect resilience: middleware can transiently send to /auth/sign-in
    if (anonPage.url().includes('/auth/sign-in')) {
      await anonPage.goto('/submit/recommend', { timeout: 60_000 })
    }

    // Wait for the flat-form heading (confirms hydration)
    await expect(
      anonPage.getByRole('heading', { name: '推薦品牌', exact: true }),
    ).toBeVisible({ timeout: 30_000 })

    // Fill required fields
    await anonPage.locator('#submit-website').fill(websiteUrl)
    await anonPage.locator('#submit-name').fill(brandName)

    // Source attribution is required when isOwner is unchecked (default)
    await anonPage.locator('#submit-source').selectOption('found_online')

    // PDPA consent
    await anonPage.locator('#submit-pdpa').check()

    // Wait for submit button to be enabled (Turnstile fires via addInitScript mock).
    // Fallback: if not enabled within 15s, post a synthetic Cloudflare postMessage.
    const submitBtn = anonPage.getByRole('button', { name: '送出推薦' })
    try {
      await expect(submitBtn).toBeEnabled({ timeout: 15_000 })
    } catch {
      await anonPage.evaluate(() => {
        // Synthetic Cloudflare Turnstile success message (last-resort fallback)
        window.dispatchEvent(
          new MessageEvent('message', {
            data: JSON.stringify({ event: 'turnstile-callback', token: 'e2e-fallback-token' }),
            origin: 'https://challenges.cloudflare.com',
          }),
        )
      })
      await anonPage.waitForTimeout(500)
    }

    await submitBtn.click()

    // Must land on the confirmation page
    await anonPage.waitForURL(/\/submit\/confirmation/, { timeout: 30_000 })

    // Confirmation heading
    await expect(
      anonPage.getByRole('heading', { name: '我們已收到你的品牌推薦' }),
    ).toBeVisible({ timeout: 15_000 })

    // Both CTAs: return home and submit another
    await expect(anonPage.locator('a[href="/"]').first()).toBeVisible()
    await expect(anonPage.locator('a[href="/submit"]').first()).toBeVisible()

    // Verify brand_submissions row was created in DB
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
    const { data, error } = await supabase
      .from('brand_submissions')
      .select('id, intent, source_attribution, submitter_email')
      .eq('brand_name', brandName)
      .single()

    expect(error).toBeNull()
    expect(data?.intent).toBe('recommend')
    expect(data?.source_attribution).toBe('found_online')
    expect(data?.submitter_email).toMatch(/^guest\+.+@guest\.formoria\.invalid$/)
  })
})
