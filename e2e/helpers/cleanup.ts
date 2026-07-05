import { createClient } from '@supabase/supabase-js';

export async function cleanupTestData() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.warn('[e2e-cleanup] SUPABASE_SERVICE_ROLE_KEY not set, skipping cleanup');
    return;
  }

  const supabase = createClient(url, key);

  const { error: brandsErr } = await supabase
    .from('brands')
    .delete()
    .like('name', '[E2E-TEST]%');

  const { error: subsErr } = await supabase
    .from('brand_submissions')
    .delete()
    .like('brand_name', '[E2E-TEST]%');

  const { error: newsletterErr } = await supabase
    .from('newsletter_subscribers')
    .delete()
    .like('email', 'e2e-%');

  const { data: usersData, error: usersErr } = await supabase.auth.admin.listUsers();
  const testUser = usersData?.users.find((user) => user.email === process.env.E2E_USER_EMAIL);
  const { error: ownerPrefsErr } = testUser
    ? await supabase
        .from('owner_email_preferences')
        .delete()
        .eq('user_id', testUser.id)
    : { error: undefined };

  if (brandsErr) console.warn('[e2e-cleanup] brands cleanup error:', brandsErr.message);
  if (subsErr) console.warn('[e2e-cleanup] brand_submissions cleanup error:', subsErr.message);
  if (newsletterErr) console.warn('[e2e-cleanup] newsletter_subscribers cleanup error:', newsletterErr.message);
  if (usersErr) console.warn('[e2e-cleanup] owner_email_preferences user lookup error:', usersErr.message);
  if (ownerPrefsErr) console.warn('[e2e-cleanup] owner_email_preferences cleanup error:', ownerPrefsErr.message);

  console.log('[e2e-cleanup] swept orphaned [E2E-TEST] rows');
}
