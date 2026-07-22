import { test, expect } from '../fixtures/auth';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

test.describe('Admin content moderation dashboard', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(() => {
    const adminEmail = process.env.E2E_ADMIN_EMAIL;
    const list = (process.env.ADMIN_EMAILS ?? '').split(',').map((e) => e.trim());
    test.skip(
      !adminEmail || !list.includes(adminEmail),
      'E2E_ADMIN_EMAIL not in ADMIN_EMAILS — admin tests require matching env',
    );
  });

  let supabase: AnySupabaseClient;
  let brandId: string;
  let testUserId: string;
  let highFlagId: string;
  let mediumFlagId: string;

  test.beforeAll(async () => {
    supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    // Resolve a real user id for moderation_flags.user_id (required FK)
    const { data: usersData, error: usersError } = await supabase.auth.admin.listUsers();
    if (usersError) throw new Error(`Failed to list users: ${usersError.message}`);
    const testUser = usersData.users.find((u) => u.email === process.env.E2E_USER_EMAIL);
    if (!testUser) throw new Error(`E2E test user not found: ${process.env.E2E_USER_EMAIL}`);
    testUserId = testUser.id;

    const ts = Date.now();
    const brandSlug = `e2e-moderation-${ts}`;

    const { data: brandData, error: brandErr } = await supabase
      .from('brands')
      .insert({
        name: `[E2E-TEST] Moderation ${ts}`,
        slug: brandSlug,
        status: 'approved',
        product_type: 'crafts',
        description: '[E2E-TEST] Suspicious moderation test brand',
        retail_locations: [],
      })
      .select('id')
      .single();
    if (brandErr || !brandData) throw new Error(`seed brand: ${brandErr?.message}`);
    brandId = brandData.id;

    // Seed two blocking violations for the queue.
    const { data: flagsData, error: flagErr } = await supabase.from('moderation_flags').insert([
      {
        brand_id: brandId,
        user_id: testUserId,
        field_name: 'website',
        flag_reason: 'Suspicious TLD detected: .tk',
        flagged_content: 'https://freegiveaway.tk',
        status: 'pending',
      },
      {
        brand_id: brandId,
        user_id: testUserId,
        field_name: 'description',
        flag_reason: 'Email address detected',
        flagged_content: '[E2E-TEST] Suspicious moderation test brand test@example.com',
        status: 'pending',
      },
    ]).select('id');
    if (flagErr) throw new Error(`seed moderation_flags: ${flagErr.message}`);
    if (!flagsData || flagsData.length !== 2) throw new Error('seed moderation_flags: missing ids');
    [highFlagId, mediumFlagId] = flagsData.map((flag) => flag.id);
  });

  test.afterAll(async () => {
    if (brandId) {
      await supabase.from('moderation_flags').delete().eq('brand_id', brandId);
      await supabase.from('brands').delete().eq('id', brandId);
    }
  });

  test('moderation dashboard shows blocked rows and review actions', async ({
    adminPage,
  }) => {
    test.setTimeout(120_000);

    await adminPage.goto('/admin/moderation', { timeout: 60_000 });
    await expect(adminPage.getByRole('main')).toBeVisible({ timeout: 60_000 });

    // Page heading: t('dashboard') = "Content Moderation"
    await expect(adminPage.getByRole('heading', { name: 'Content Moderation' })).toBeVisible({ timeout: 60_000 });

    // The seeded brand's flag rows appear in the table
    await expect(adminPage.getByText(/\[E2E-TEST\] Moderation/).first()).toBeVisible({ timeout: 30_000 });

    await expect(adminPage.locator('table').getByRole('columnheader', { name: 'Actions' })).toBeVisible();
    await expect(adminPage.getByRole('button', { name: 'Mark reviewed' }).first()).toBeVisible();
    await expect(adminPage.getByRole('button', { name: 'Dismiss' }).first()).toBeVisible();
  });

  test('moderation dashboard has no tier or risk filters', async ({
    adminPage,
  }) => {
    test.setTimeout(120_000);

    await adminPage.goto('/admin/moderation', { timeout: 60_000 });
    await expect(adminPage.getByRole('main')).toBeVisible({ timeout: 60_000 });

    await expect(adminPage.getByText('Filter by risk')).toHaveCount(0);
    await expect(adminPage.getByText('Filter by tier')).toHaveCount(0);
    await expect(adminPage.getByText('Suspicious domain')).toBeVisible({ timeout: 10_000 });
    await expect(adminPage.getByText('Email address')).toBeVisible({ timeout: 10_000 });
  });

  test('moderators can review or dismiss pending flags', async ({ adminPage }) => {
    test.setTimeout(120_000);

    await adminPage.goto('/admin/moderation', { timeout: 60_000 });
    await expect(adminPage.getByRole('main')).toBeVisible({ timeout: 60_000 });

    const highRow = adminPage.locator('tbody tr').filter({
      hasText: '[E2E-TEST] Moderation',
    }).filter({ hasText: 'High Risk' }).first();
    await expect(highRow).toBeVisible({ timeout: 30_000 });
    await highRow.getByRole('button', { name: 'Mark reviewed' }).click();
    await expect(highRow).toHaveCount(0, { timeout: 30_000 });

    const mediumRow = adminPage.locator('tbody tr').filter({
      hasText: '[E2E-TEST] Moderation',
    }).filter({ hasText: 'Medium Risk' }).first();
    await expect(mediumRow).toBeVisible({ timeout: 30_000 });
    await mediumRow.getByRole('button', { name: 'Dismiss' }).click();
    await expect(mediumRow).toHaveCount(0, { timeout: 30_000 });

    const { data: flags, error } = await supabase
      .from('moderation_flags')
      .select('id, status')
      .in('id', [highFlagId, mediumFlagId]);
    expect(error).toBeNull();
    expect(flags).toEqual(expect.arrayContaining([
      { id: highFlagId, status: 'reviewed' },
      { id: mediumFlagId, status: 'dismissed' },
    ]));
  });
});
