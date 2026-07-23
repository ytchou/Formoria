import { test, expect } from '../fixtures/auth'

/**
 * FAQ page
 *
 * Journey: Anonymous visitor lands on /faq (zh-TW, the default locale path),
 * sees both section headings and all 20 expandable items; hash links scroll
 * the correct section into view; the #claim item auto-opens via the
 * OpenTargetDetails client component.
 *
 * Actor: anonPage (no authentication, no DB state)
 * Seed: none
 */
test.describe('FAQ page', () => {
  test('renders two section headings and exactly 20 details elements', async ({ anonPage }) => {
    test.setTimeout(30_000)

    // /faq is the zh-TW canonical URL (localePrefix: 'as-needed', defaultLocale: 'zh-TW')
    const resp = await anonPage.goto('/faq', { timeout: 30_000 })
    if (resp?.status() === 503) {
      test.skip(true, 'PREVIEW_MODE active — skipping')
      return
    }

    // Both section-level h2 headings must be present
    await expect(anonPage.getByRole('heading', { name: '一般問題', level: 2 })).toBeVisible({
      timeout: 15_000,
    })
    await expect(anonPage.getByRole('heading', { name: '品牌主專區', level: 2 })).toBeVisible({
      timeout: 5_000,
    })

    // 11 general + 1 contact + 8 owner = 20 total <details> elements
    await expect(anonPage.locator('details')).toHaveCount(20, { timeout: 5_000 })
  })

  test('#for-owners anchor scrolls the section into viewport', async ({ anonPage }) => {
    test.setTimeout(30_000)

    const resp = await anonPage.goto('/faq#for-owners', { timeout: 30_000 })
    if (resp?.status() === 503) {
      test.skip(true, 'PREVIEW_MODE active — skipping')
      return
    }

    // The <section id="for-owners"> must be within the viewport after hash navigation
    await expect(anonPage.locator('#for-owners')).toBeInViewport({ timeout: 10_000 })
  })

  test('#claim details auto-opens via OpenTargetDetails on hash navigation', async ({
    anonPage,
  }) => {
    test.setTimeout(30_000)

    const resp = await anonPage.goto('/faq#claim', { timeout: 30_000 })
    if (resp?.status() === 503) {
      test.skip(true, 'PREVIEW_MODE active — skipping')
      return
    }

    // OpenTargetDetails runs a useEffect that sets <details id="claim">.open = true.
    // Poll until hydration completes and the attribute is set.
    await expect(async () => {
      const isOpen = await anonPage.evaluate(() => {
        const el = document.getElementById('claim')
        return el ? el.open : false
      })
      expect(isOpen).toBe(true)
    }).toPass({ timeout: 5_000 })
  })
})
