import { BUDGET } from '../budgets';
import { test, expect } from '../fixtures/auth';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

test.describe('MIT verification badges', () => {
  let supabase: AnySupabaseClient;
  let mitBrandId: string;
  let mitBrandSlug: string;
  let mitBrandName: string;

  test.beforeAll(async () => {
    supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const ts = Date.now();

    // Seed MIT-verified brand (mit_status = 'verified', no brand_owners row)
    mitBrandName = `[E2E-TEST] MIT Verified ${ts}`;
    mitBrandSlug = `e2e-mit-verified-${ts}`;
    const { data: mitData, error: mitErr } = await supabase
      .from('brands')
      .insert({
        name: mitBrandName,
        slug: mitBrandSlug,
        status: 'approved',
        approved_at: new Date().toISOString(),
        category: 'home',
        description: 'E2E throwaway — MIT verified brand.',
        mit_status: 'verified',
        mit_verified_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    if (mitErr || !mitData) throw new Error(`Failed to seed MIT brand: ${mitErr?.message}`);
    mitBrandId = mitData.id;
  });

  test.afterAll(async () => {
    if (!supabase) return;
    const cleanupErrors: string[] = [];
    if (mitBrandId) {
      const { error: mitBrandError } = await supabase.from('brands').delete().eq('id', mitBrandId);
      if (mitBrandError) cleanupErrors.push(`MIT brand deletion failed: ${mitBrandError.message}`);
    }
    if (cleanupErrors.length > 0) {
      throw new Error(`[e2e-cleanup] MIT verification cleanup failed — ${cleanupErrors.join('; ')}`);
    }
  });

  test('MIT-verified brand shows gold MIT badge on detail page', async ({ anonPage }) => {
    const resp = await anonPage.goto(`/brands/${mitBrandSlug}`);
    if (resp?.status() === 503) {
      test.skip(true, 'PREVIEW_MODE active — skipping.');
      return;
    }

    await expect(anonPage.getByRole('heading', { level: 1, name: mitBrandName })).toBeVisible({
      timeout: BUDGET.INTERACTIVE,
    });

    // MIT badge in brand-header: label = 'MIT 微笑認證', title = '已通過 MIT 微笑標章登錄驗證'
    const mitBadge = anonPage.locator('span[title="已通過 MIT 微笑標章登錄驗證"]').first();
    await expect(mitBadge).toBeVisible({ timeout: BUDGET.RENDERED });
    await expect(mitBadge).toContainText('MIT 微笑認證');
  });
});
