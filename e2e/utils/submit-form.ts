import { type Page, expect } from '@playwright/test'

export async function gotoSubmitRecommend(
  page: Page,
  opts?: { timeout?: number },
): Promise<void> {
  const timeout = opts?.timeout ?? 90_000

  await expect(async () => {
    await page.goto('/submit/recommend', { timeout: 60_000 })

    const heading = page.getByRole('heading', { name: '推薦品牌', exact: true })
    const visible = await heading.isVisible({ timeout }).catch(() => false)
    if (visible) {
      return
    }

    await expect(heading).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout, intervals: [2_000, 4_000, 8_000] })
}

export async function gotoSubmitOwner(
  page: Page,
  opts?: { timeout?: number },
): Promise<void> {
  const timeout = opts?.timeout ?? 90_000

  await expect(async () => {
    await page.goto('/submit/owner/quick', { timeout: 60_000 })
    await expect(
      page.getByRole('heading', { name: '快速提交品牌', exact: true }),
    ).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout, intervals: [2_000, 4_000, 8_000] })
}
