import { createClient } from '@supabase/supabase-js';

export async function cleanupTestData() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.warn('[e2e-cleanup] SUPABASE_SERVICE_ROLE_KEY not set, skipping cleanup');
    return;
  }

  const supabase = createClient(url, key);

  // Must delete pending_brand_edits before brands (FK constraint)
  const { data: testBrands } = await supabase
    .from('brands')
    .select('id')
    .like('name', '[E2E-TEST]%');

  if (testBrands && testBrands.length > 0) {
    const brandIds = testBrands.map((b: { id: string }) => b.id);
    const { error: editsErr } = await supabase
      .from('pending_brand_edits')
      .delete()
      .in('brand_id', brandIds);
    if (editsErr) console.warn('[e2e-cleanup] pending_brand_edits cleanup error:', editsErr.message);
  }

  const { error: brandsErr } = await supabase
    .from('brands')
    .delete()
    .like('name', '[E2E-TEST]%');

  const { error: subsErr } = await supabase
    .from('brand_submissions')
    .delete()
    .like('brand_name', '[E2E-TEST]%');

  if (brandsErr) console.warn('[e2e-cleanup] brands cleanup error:', brandsErr.message);
  if (subsErr) console.warn('[e2e-cleanup] brand_submissions cleanup error:', subsErr.message);

  console.log('[e2e-cleanup] swept orphaned [E2E-TEST] rows');
}
