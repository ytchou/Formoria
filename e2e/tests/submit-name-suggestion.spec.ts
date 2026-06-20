import { test, expect } from '../fixtures/auth';
import { gotoSubmitWizard } from '../utils/submit-wizard';

const manualEntryButtonName = '跳過，手動填寫';

// ---------------------------------------------------------------------------
// Journey: Name cleanup suggestion
// After the user types a dirty brand name and blurs the field, a suggestion
// alert appears with the cleaned name and an Apply button. Clicking Apply
// replaces the field value and dismisses the alert.
// ---------------------------------------------------------------------------
test.describe('Submit name suggestion', () => {
  test('dirty name with emoji shows suggestion alert; Apply updates field and dismisses alert', async ({
    userPage,
  }) => {
    test.setTimeout(60_000);

    await gotoSubmitWizard(userPage);

    // Skip URL scraping step → land on BrandInfoStep
    const skipBtn = userPage.getByRole('button', {
      name: manualEntryButtonName,
      exact: true,
    });
    await expect(skipBtn).toBeVisible({ timeout: 5_000 });
    await skipBtn.click();

    // Wait for the name field to mount
    const nameInput = userPage.locator('#brand-name');
    await expect(nameInput).toBeVisible({ timeout: 5_000 });

    // Type a name that contains an emoji — triggers the emoji cleanup pattern
    await nameInput.fill('TestBrand🥑');

    // Blur via Tab key (more reliable than .blur() for triggering React onBlur)
    await nameInput.press('Tab');

    // Suggestion alert must appear — locate by unique content rather than
    // bare role="alert" (avoids collision with route announcer / other alerts)
    const suggestionAlert = userPage.getByText('建議名稱：');
    await expect(suggestionAlert).toBeVisible({ timeout: 15_000 });

    // Alert body contains the cleaned name
    const alertContainer = suggestionAlert.locator('..');
    await expect(alertContainer).toContainText('TestBrand');

    // Apply button is present
    const applyBtn = userPage.getByRole('button', {
      name: '套用',
      exact: true,
    });
    await expect(applyBtn).toBeVisible();

    // Click Apply
    await applyBtn.click();

    // Field now holds the cleaned name
    await expect(nameInput).toHaveValue('TestBrand');

    // Suggestion alert must disappear after Apply
    await expect(suggestionAlert).not.toBeVisible();
  });

  test('editing the name after suggestion dismisses the alert', async ({
    userPage,
  }) => {
    test.setTimeout(60_000);

    await gotoSubmitWizard(userPage);

    const skipBtn = userPage.getByRole('button', {
      name: manualEntryButtonName,
      exact: true,
    });
    await expect(skipBtn).toBeVisible({ timeout: 5_000 });
    await skipBtn.click();

    const nameInput = userPage.locator('#brand-name');
    await expect(nameInput).toBeVisible({ timeout: 5_000 });

    await nameInput.fill('TestBrand🥑');
    await nameInput.press('Tab');

    const suggestionAlert = userPage.getByText('建議名稱：');
    await expect(suggestionAlert).toBeVisible({ timeout: 15_000 });

    // User resumes typing — onChange clears the suggestion
    await nameInput.focus();
    await nameInput.fill('TestBrand Updated');

    await expect(suggestionAlert).not.toBeVisible();
  });
});
