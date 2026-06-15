import { test, expect } from '../fixtures/auth'
import { gotoSubmitWizard } from '../utils/submit-wizard'

test.describe('Submit multi-URL affordances', () => {
  test('adds URL rows up to the cap and removes a row', async ({ userPage }) => {
    test.setTimeout(120_000)
    await gotoSubmitWizard(userPage)

    // This spec intentionally stops in UrlStep; it does not submit BrandInfoStep
    // data or create/share brands, so no downstream wizard or pending-edit fix is needed.
    const urlInputs = userPage.locator('input[type="url"]')

    await expect(urlInputs).toHaveCount(2)

    const addLinkButton = userPage.getByRole('button', { name: /新增.*連結/ })
    await expect(addLinkButton).toBeVisible({ timeout: 15_000 })
    await addLinkButton.click()
    await addLinkButton.click()

    await expect(urlInputs).toHaveCount(4)
    await expect(addLinkButton).toBeHidden()

    // Remove button has aria-label '移除連結'
    await userPage.getByRole('button', { name: '移除連結', exact: true }).first().click()
    await expect(urlInputs).toHaveCount(3)
  })
})
