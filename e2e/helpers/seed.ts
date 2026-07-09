import { createClient, SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null = null;

function getServiceClient(): SupabaseClient {
  if (!_client) {
    _client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }
  return _client;
}

export interface SeededBrand {
  brand: { id: string; slug: string; name: string; status: string };
  slug: string;
  cleanup: () => Promise<void>;
}

export async function seedBrand(opts: {
  name: string;
  status?: 'approved' | 'hidden';
  workerIndex: number;
  withLinks?: boolean;
  withOwner?: boolean;
}): Promise<SeededBrand> {
  const supabase = getServiceClient();
  const ts = Date.now();
  const status = opts.status ?? 'approved';
  const slug = `e2e-${opts.name}-${ts}-${opts.workerIndex}`;
  const fullName = `[E2E-TEST] ${opts.name} ${ts}`;

  let testUserId: string | null = null;
  if (opts.withOwner) {
    const { data: users } = await supabase.auth.admin.listUsers();
    const testUser = users?.users?.find(
      (u) => u.email === process.env.E2E_USER_EMAIL,
    );
    if (!testUser) throw new Error('E2E test user not found — check E2E_USER_EMAIL');
    testUserId = testUser.id;
  }

  const brandData: Record<string, unknown> = {
    name: fullName,
    slug,
    status,
    product_type: 'crafts',
    founding_year: '2020',
  };

  if (opts.withLinks) {
    brandData.social_instagram = 'https://instagram.com/e2e-test';
    brandData.social_facebook = 'https://facebook.com/e2e-test';
    brandData.purchase_website = 'https://e2e-test.com/shop';
  }

  const { data: brand, error } = await supabase
    .from('brands')
    .insert(brandData)
    .select()
    .single();

  if (error || !brand) {
    throw new Error(
      `seedBrand insert failed: ${error?.message} (code: ${error?.code}, details: ${error?.details})`,
    );
  }

  if (opts.withOwner && testUserId) {
    const { error: ownerError } = await supabase
      .from('brand_owners')
      .insert({ brand_id: brand.id, user_id: testUserId });
    if (ownerError) {
      // Duplicate key means user already owns another brand — non-fatal for most tests.
      if (ownerError.code === '23505') {
        console.warn(`[e2e-seed] withOwner: user already owns a brand (${ownerError.message}) — continuing without ownership`);
      } else {
        await supabase.from('brands').delete().eq('id', brand.id);
        throw new Error(`seedBrand brand_owners insert failed: ${ownerError.message}`);
      }
    }
  }

  const cleanup = async () => {
    const { error } = await supabase.from('brands').delete().eq('id', brand.id);
    if (error) console.warn('[e2e-seed] cleanup failed:', error.message);
  };

  return { brand, slug, cleanup };
}
