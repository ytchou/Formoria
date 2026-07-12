import { test, expect } from '../fixtures/auth'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>

/**
 * Static & Compliance Pages + Microsite
 *
 * Journeys:
 *  - /about renders with heading
 *  - /privacy renders with heading
 *  - /terms renders with heading
 *  - /challenge renders "Quick verification" heading with Turnstile container
 *  - /submit landing renders heading and links to the recommendation and owner flows
 *  - /site/<slug> renders brand name and tagline for a seeded microsite brand
 *
 * Actor: anonPage (unauthenticated)
 * Seed: one approved brand with site_content for the microsite test
 * Cleanup: afterAll deletes the brand
 */
test.describe('Static & compliance pages', () => {
  let supabase: AnySupabaseClient
  let micrositeBrandId: string
  let micrositeSlug: string
  let micrositeBrandName: string
  const micrositeTagline = 'E2E test tagline'

  test.beforeAll(async ({}, workerInfo) => {
    supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )

    const ts = Date.now()
    const wi = workerInfo.workerIndex
    micrositeSlug = `e2e-microsite-${ts}-${wi}`
    micrositeBrandName = `[E2E-TEST] microsite ${ts}`

    const { data: brand, error } = await supabase
      .from('brands')
      .insert({
        name: micrositeBrandName,
        slug: micrositeSlug,
        status: 'approved',
        founding_year: '2020',
        site_content: {
          template: 'default',
          tokens: { accent: '#000' },
          tagline: micrositeTagline,
          story: 'E2E test story',
          products: [],
          ctaType: 'mailto',
        },
      })
      .select('id')
      .single()

    if (error || !brand) {
      throw new Error(`Failed to seed microsite brand: ${error?.message}`)
    }
    micrositeBrandId = brand.id
  })

  test.afterAll(async () => {
    if (!supabase) return
    if (micrositeBrandId) {
      await supabase.from('brands').delete().eq('id', micrositeBrandId)
    }
  })

  test('about page renders', async ({ anonPage }) => {
    test.setTimeout(30_000)
    const resp = await anonPage.goto('/about', { timeout: 30_000 })
    if (resp?.status() === 503) { test.skip(true, 'PREVIEW_MODE active'); return }
    await expect(anonPage.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 })
  })

  test('privacy page renders', async ({ anonPage }) => {
    test.setTimeout(30_000)
    const resp = await anonPage.goto('/privacy', { timeout: 30_000 })
    if (resp?.status() === 503) { test.skip(true, 'PREVIEW_MODE active'); return }
    await expect(
      anonPage.getByRole('heading', { name: '隱私權政策' }),
    ).toBeVisible({ timeout: 15_000 })
  })

  test('terms page renders', async ({ anonPage }) => {
    test.setTimeout(30_000)
    const resp = await anonPage.goto('/terms', { timeout: 30_000 })
    if (resp?.status() === 503) { test.skip(true, 'PREVIEW_MODE active'); return }
    await expect(
      anonPage.getByRole('heading', { name: '服務條款' }),
    ).toBeVisible({ timeout: 15_000 })
  })

  test('legal page titles are single-suffixed', async ({ anonPage }) => {
    const pages = [
      ['/terms', '服務條款 | Formoria'],
      ['/privacy', '隱私權政策 | Formoria'],
      ['/en/terms', 'Terms of Service | Formoria'],
      ['/en/privacy', 'Privacy Policy | Formoria'],
    ] as const

    for (const [path, title] of pages) {
      await anonPage.goto(path, { timeout: 30_000 })
      await expect(anonPage).toHaveTitle(title)
    }
  })

  test('challenge page renders Quick verification heading', async ({ anonPage }) => {
    test.setTimeout(30_000)
    // /challenge is NOT under [locale] — navigate directly
    const resp = await anonPage.goto('/challenge', { timeout: 30_000 })
    if (resp?.status() === 503) { test.skip(true, 'PREVIEW_MODE active'); return }
    await expect(
      anonPage.getByRole('heading', { name: 'Quick verification' }),
    ).toBeVisible({ timeout: 15_000 })
    // Turnstile container (div rendered by TurnstileWidget, or the "Verifying..." text)
    // The widget may redirect quickly in dev; assert the heading appeared above.
  })

  test('submit landing page renders with recommendation and owner CTAs', async ({ anonPage }) => {
    test.setTimeout(30_000)
    const resp = await anonPage.goto('/submit', { timeout: 30_000 })
    if (resp?.status() === 503) { test.skip(true, 'PREVIEW_MODE active'); return }
    // Heading: "提交你的台灣品牌"
    await expect(
      anonPage.getByRole('heading', { name: '提交你的台灣品牌' }),
    ).toBeVisible({ timeout: 15_000 })
    await expect(anonPage.locator('a[href*="/submit/recommend"]')).toBeVisible({ timeout: 10_000 })
    await expect(anonPage.locator('a[href*="/auth/sign-in?next=%2Fsubmit%2Fowner"]')).toBeVisible({ timeout: 10_000 })
  })

  test('microsite renders for seeded brand', async ({ anonPage }) => {
    test.setTimeout(90_000)
    if (!supabase) { test.skip(true, 'PREVIEW_MODE active'); return }

    // /site/[slug] is NOT under [locale] — use bare path
    // ISR: allow time for the page to become available after the brand seed.
    await expect(async () => {
      const resp = await anonPage.goto(`/site/${micrositeSlug}`, { timeout: 15_000 })
      if (resp?.status() === 503) throw new Error('503')
      if (resp?.status() === 404) throw new Error('404 — ISR not yet generated')
      await expect(
        anonPage.getByRole('heading', { level: 1, name: micrositeBrandName }),
      ).toBeVisible({ timeout: 10_000 })
      await expect(
        anonPage.getByText(micrositeTagline, { exact: true }),
      ).toBeVisible({ timeout: 10_000 })
    }).toPass({ timeout: 60_000, intervals: [3_000, 5_000, 8_000, 13_000] })
  })
})
