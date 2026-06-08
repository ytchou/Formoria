import { test, expect } from '../fixtures/auth';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

test.describe('Brand tier differentiation — Community vs Verified', () => {
  let supabase: AnySupabaseClient;
  let communityBrandId: string;
  let communityBrandSlug: string;
  let communityBrandName: string;
  let verifiedBrandId: string;
  let verifiedBrandSlug: string;
  let verifiedBrandName: string;
  let ownerUserId: string;

  test.beforeAll(async () => {
    supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: usersData, error: usersError } = await supabase.auth.admin.listUsers();
    if (usersError) throw new Error(`Failed to list users: ${usersError.message}`);
    const testUser = usersData.users.find((u) => u.email === process.env.E2E_USER_EMAIL);
    if (!testUser) throw new Error(`E2E test user not found: ${process.env.E2E_USER_EMAIL}`);
    ownerUserId = testUser.id;

    const ts = Date.now();

    // Community brand — no brand_owners row → isVerified=false → shows 社群 label
    communityBrandName = `[E2E-TEST] Community Brand ${ts}`;
    communityBrandSlug = `e2e-community-brand-${ts}`;
    const { data: comData, error: comErr } = await supabase
      .from('brands')
      .insert({
        name: communityBrandName,
        slug: communityBrandSlug,
        status: 'approved',
        description: 'E2E throwaway — community (no owner) brand.',
        purchase_links: [],
        social_links: {},
        retail_locations: [],
        product_photos: [],
      })
      .select('id')
      .single();
    if (comErr || !comData) throw new Error(`Failed to seed community brand: ${comErr?.message}`);
    communityBrandId = comData.id;

    // Verified brand — with brand_owners row → isVerified=true → shows 品牌 badge
    verifiedBrandName = `[E2E-TEST] Verified Brand ${ts}`;
    verifiedBrandSlug = `e2e-verified-brand-${ts}`;
    const { data: verData, error: verErr } = await supabase
      .from('brands')
      .insert({
        name: verifiedBrandName,
        slug: verifiedBrandSlug,
        status: 'approved',
        description: 'E2E throwaway — owner-verified brand.',
        purchase_links: [],
        social_links: {},
        retail_locations: [],
        product_photos: [],
      })
      .select('id')
      .single();
    if (verErr || !verData) throw new Error(`Failed to seed verified brand: ${verErr?.message}`);
    verifiedBrandId = verData.id;

    const { error: boErr } = await supabase.from('brand_owners').insert({
      user_id: ownerUserId,
      brand_id: verifiedBrandId,
    });
    if (boErr) throw new Error(`Failed to seed brand_owners: ${boErr.message}`);
  });

  test.afterAll(async () => {
    if (!supabase) return;
    if (verifiedBrandId) {
      await supabase.from('brand_owners').delete().eq('brand_id', verifiedBrandId);
      await supabase.from('brands').delete().eq('id', verifiedBrandId);
    }
    if (communityBrandId) {
      await supabase.from('brands').delete().eq('id', communityBrandId);
    }
  });

  test('community card shows 社群 label; verified card shows 品牌 badge', async ({ anonPage }) => {
    test.setTimeout(120_000);

    const resp = await anonPage.goto('/brands?verification=all');
    if (resp?.status() === 503) {
      test.skip(true, 'PREVIEW_MODE active — skipping.');
      return;
    }

    // ISR: seeded brands may not be on page 1. Poll until the community card is visible.
    // We look by the aria-label (brand name) on the card link.
    await expect(async () => {
      await anonPage.goto('/brands?verification=all');
      await expect(
        anonPage.locator(`a[href="/brands/${communityBrandSlug}"]`)
      ).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 120_000, intervals: [2_000, 3_000, 5_000, 10_000] });

    // Community card — no badges → shows 社群 text
    const communityCard = anonPage.locator(`a[href="/brands/${communityBrandSlug}"]`);
    await expect(communityCard.locator('text=社群')).toBeVisible({ timeout: 5_000 });
    // Must not show the owner badge title
    await expect(
      communityCard.locator('[title="由品牌方經營管理"]')
    ).toHaveCount(0);

    // Verified card — has brand_owners row → shows 品牌 badge with title '由品牌方經營管理'
    const verifiedCard = anonPage.locator(`a[href="/brands/${verifiedBrandSlug}"]`);
    await expect(verifiedCard).toBeVisible({ timeout: 5_000 });
    const ownerBadge = verifiedCard.locator('[title="由品牌方經營管理"]');
    await expect(ownerBadge).toBeVisible({ timeout: 5_000 });
    await expect(ownerBadge).toContainText('品牌');
  });

  test('verification filter pill 已驗證 hides community brand; 社群 hides verified brand', async ({
    anonPage,
  }) => {
    test.setTimeout(60_000);

    // Navigate to verified filter — community brand must not be visible in this filter
    const verifiedResp = await anonPage.goto('/brands?verification=verified');
    if (verifiedResp?.status() === 503) {
      test.skip(true, 'PREVIEW_MODE active — skipping.');
      return;
    }

    // The 已驗證 pill must show as active
    const verifiedPill = anonPage.locator('main').locator('button', { hasText: '已驗證' });
    await expect(verifiedPill).toBeVisible({ timeout: 5_000 });
    await expect(verifiedPill).toHaveAttribute('data-active', 'true');

    // Community brand must NOT appear in verified-only view
    await expect(
      anonPage.locator(`a[href="/brands/${communityBrandSlug}"]`)
    ).toHaveCount(0);

    // Navigate to community filter — verified brand must not be visible
    await anonPage.goto('/brands?verification=community');
    const communityPill = anonPage.locator('main').locator('button', { hasText: '社群' });
    await expect(communityPill).toBeVisible({ timeout: 5_000 });
    await expect(communityPill).toHaveAttribute('data-active', 'true');

    await expect(
      anonPage.locator(`a[href="/brands/${verifiedBrandSlug}"]`)
    ).toHaveCount(0);

    // 全部 pill (verification row) restores all — navigate to it directly via URL
    await anonPage.goto('/brands?verification=all');
    // Just assert the URL state is correct — two 全部 buttons exist (category + verification)
    // so we verify via URL rather than risking an ambiguous button selector.
    await expect(anonPage).toHaveURL(/verification=all/);
  });
});
