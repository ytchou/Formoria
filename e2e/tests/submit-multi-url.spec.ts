import { test, expect } from '../fixtures/auth'

test.describe('Submit multi-URL affordances', () => {
  test('adds URL rows up to the cap and removes a row', async ({ userPage }) => {
    await userPage.goto('/submit')

    // Wait for the wizard outer h1, then the UrlStep h2 to confirm client hydration completed.
    // The UrlStep (phase='url') renders immediately for authenticated users and contains
    // the multi-URL inputs — no extra navigation step required.
    await expect(userPage.getByRole('heading', { name: '提交品牌', exact: true })).toBeVisible({
      timeout: 10_000,
    })
    await expect(userPage.getByRole('heading', { name: '提交你喜愛的品牌', exact: true })).toBeVisible({
      timeout: 10_000,
    })

    const urlInputs = userPage.locator('input[type="url"]')
    await expect(urlInputs.first()).toBeVisible({ timeout: 5_000 })

    // '新增連結' is the exact translated label for the add-URL button
    const addLinkButton = userPage.getByRole('button', { name: '新增連結', exact: true })
    await addLinkButton.click()
    await addLinkButton.click()

    await expect(urlInputs).toHaveCount(3)
    await expect(addLinkButton).toBeHidden()

    // Remove button has aria-label '移除連結'
    await userPage.getByRole('button', { name: '移除連結', exact: true }).first().click()
    await expect(urlInputs).toHaveCount(2)
  })
})
