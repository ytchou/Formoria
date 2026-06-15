import { test, expect } from '../fixtures/auth';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { gotoSubmitWizard } from '../utils/submit-wizard';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

const manualEntryButtonName = '跳過，手動填寫';
const nextButtonName = '下一步';

// ---------------------------------------------------------------------------
// Journey 1: UBN hard-block
// ---------------------------------------------------------------------------
test.describe('Submit dedup — UBN hard-block', () => {
  let supabase: AnySupabaseClient;
  let seededBrandId: string;
  const UBN = '12345678';

  test.beforeAll(async () => {
    supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const ts = Date.now();
    const slug = `e2e-ubn-dedup-${ts}`;
    const { data, error } = await supabase
      .from('brands')
      .insert({
        name: `[E2E-TEST] UBN Dedup Seed ${ts}`,
        slug,
        status: 'approved',
        description: 'Seeded by e2e submit-dedup spec for UBN hard-block journey.',
        unified_business_number: UBN,
        purchase_links: [],
        social_links: {},
        retail_locations: [],
        product_photos: [],
      })
      .select('id')
      .single();

    if (error || !data) {
      throw new Error(`[submit-dedup] Failed to seed UBN brand: ${error?.message}`);
    }
    seededBrandId = data.id;
  });

  test.afterAll(async () => {
    if (seededBrandId) {
      await supabase.from('brands').delete().eq('id', seededBrandId);
    }
  });

  test('wizard is hard-blocked when UBN matches an existing approved brand', async ({
    userPage,
  }) => {
    test.setTimeout(60_000);

    await gotoSubmitWizard(userPage);

    // Skip URL scraping, go to BrandInfoStep
    const skipBtn = userPage.getByRole('button', {
      name: manualEntryButtonName,
      exact: true,
    });
    await expect(skipBtn).toBeVisible({ timeout: 5_000 });
    await skipBtn.click();

    await expect(userPage.locator('#brand-name')).toBeVisible({ timeout: 5_000 });

    // Fill name (required field must be non-empty to reach dedup check)
    await userPage
      .locator('#brand-name')
      .fill(`[E2E-TEST] UBN Dedup Test ${Date.now()}`);

    // Fill the UBN that matches the seeded brand
    await userPage.locator('#brand-ubn').fill(UBN);

    // Click 下一步 — should trigger dedup check and hard-block
    await userPage
      .getByRole('button', { name: nextButtonName, exact: true })
      .click();

    // Hard-block alert must appear (role=alert, destructive variant).
    // Exclude the Next.js route announcer (#__next-route-announcer__) which
    // also has role="alert" but is always empty.
    const hardBlockAlert = userPage.locator('[role="alert"]:not(#__next-route-announcer__)');
    await expect(hardBlockAlert).toBeVisible({ timeout: 10_000 });

    // Alert text surfaces the UBN duplicate title
    await expect(hardBlockAlert).toContainText('此統一編號的品牌已存在於目錄中');

    // Alert contains a link to the existing brand
    await expect(hardBlockAlert.locator('a')).toBeVisible();

    // 下一步 button is disabled — wizard stays on step 0
    const nextBtn = userPage.getByRole('button', { name: nextButtonName, exact: true });
    await expect(nextBtn).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// Journey 2: Fuzzy name warning + acknowledge
// ---------------------------------------------------------------------------
test.describe('Submit dedup — fuzzy name warning', () => {
  let supabase: AnySupabaseClient;
  let seededBrandId: string;
  let seededBrandName: string;

  test.beforeAll(async () => {
    supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const ts = Date.now();
    seededBrandName = `[E2E-TEST] Dedup Similar ${ts}`;
    const slug = `e2e-similar-dedup-${ts}`;

    const { data, error } = await supabase
      .from('brands')
      .insert({
        name: seededBrandName,
        slug,
        status: 'approved',
        description: 'Seeded by e2e submit-dedup spec for fuzzy name journey.',
        purchase_links: [],
        social_links: {},
        retail_locations: [],
        product_photos: [],
      })
      .select('id')
      .single();

    if (error || !data) {
      throw new Error(
        `[submit-dedup] Failed to seed similar-name brand: ${error?.message}`
      );
    }
    seededBrandId = data.id;
  });

  test.afterAll(async () => {
    if (seededBrandId) {
      await supabase.from('brands').delete().eq('id', seededBrandId);
    }
  });

  test('shows similarity warning and requires acknowledgment before advancing', async ({
    userPage,
  }) => {
    test.setTimeout(60_000);

    await gotoSubmitWizard(userPage);

    // Skip URL scraping, go to BrandInfoStep
    const skipBtn = userPage.getByRole('button', {
      name: manualEntryButtonName,
      exact: true,
    });
    await expect(skipBtn).toBeVisible({ timeout: 5_000 });
    await skipBtn.click();

    await expect(userPage.locator('#brand-name')).toBeVisible({ timeout: 5_000 });

    // Fill brand name identical to seeded brand (100% similarity)
    await userPage.locator('#brand-name').fill(seededBrandName);
    // Leave UBN empty

    // Pre-fill all other required fields so the wizard can advance after dedup acknowledgment.
    await userPage
      .locator('#brand-description')
      .fill(
        '這是一個用於 E2E 重複品牌檢測測試的台灣本地品牌，描述至少須達四十個字元以滿足驗證需求。'
      );

    // Click 下一步 — dedup check should surface warning
    await userPage
      .getByRole('button', { name: nextButtonName, exact: true })
      .click();

    // Fuzzy warning alert must appear (non-destructive variant).
    // Exclude the Next.js route announcer (#__next-route-announcer__) which
    // also has role="alert" but is always empty.
    const warningAlert = userPage.locator('[role="alert"]:not(#__next-route-announcer__)');
    await expect(warningAlert).toBeVisible({ timeout: 10_000 });

    // Alert surfaces the name duplicate title
    await expect(warningAlert).toContainText('發現相似品牌名稱');

    // Seeded brand name appears in the warning with similarity percentage
    await expect(warningAlert).toContainText(seededBrandName);
    await expect(warningAlert).toContainText('%');

    // Acknowledgment checkbox — Base UI Checkbox renders a hidden native input (aria-hidden)
    // with the id. The visible interactive element is a button[role="checkbox"] without the id.
    // Use getByRole('checkbox') with its label text for reliable interaction.
    const confirmCheckbox = userPage.getByRole('checkbox', {
      name: '我確認這不是重複的品牌',
    });
    await expect(confirmCheckbox).toBeVisible();
    await expect(confirmCheckbox).not.toBeChecked();

    // Click 下一步 without acknowledging — wizard must stay on BrandInfoStep
    await userPage
      .getByRole('button', { name: nextButtonName, exact: true })
      .click();

    // Wait for the dedup check to complete (button returns from "檢查中" → "下一步").
    // This prevents a race where the second click's async setDedupConfirmed(false) fires
    // after the checkbox click's setDedupConfirmed(true), which would reset the checkbox.
    await expect(
      userPage.getByRole('button', { name: nextButtonName, exact: true })
    ).toBeVisible({ timeout: 10_000 });

    // BrandInfoStep fields are still visible (did not advance)
    await expect(userPage.locator('#brand-name')).toBeVisible({ timeout: 3_000 });

    // Check the acknowledgment checkbox — now safe to click since the previous
    // async handler (setDedupConfirmed(false)) has already completed.
    await confirmCheckbox.click();
    await expect(confirmCheckbox).toBeChecked();

    // Click 下一步 — dedup gate is now lifted; the call reaches onNext (SubmitWizard's
    // handleNext), which runs step-schema validation. The button momentarily shows
    // "檢查中" then returns to "下一步" once the dedup check completes.
    await userPage
      .getByRole('button', { name: nextButtonName, exact: true })
      .click();

    // After the dedup check on the third click completes with hasConfirmedCurrentDuplicate=true,
    // the code does NOT call setDedupConfirmed(false) — so the checkbox must remain checked.
    // This is the key assertion: the dedup gate was passed (not rejected), confirming the
    // acknowledgment mechanism works correctly.
    await expect(confirmCheckbox).toBeChecked({ timeout: 10_000 });
  });
});
