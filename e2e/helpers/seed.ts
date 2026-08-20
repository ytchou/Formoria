import { createClient, SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null = null;

/**
 * Exported so e2e utils share ONE service-role client instead of each keeping a
 * private copy of this construction (there were six). Memoized: callers may
 * rely on repeated calls returning the same instance.
 */
export function getServiceClient(): SupabaseClient {
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
  /**
   * Seed a brand whose ONLY purchase channel is 7-ELEVEN 賣貨便 (`purchase_myship`),
   * with `purchase_website` left NULL. Covers the case a website-centric fixture
   * cannot: that a non-website channel alone is enough to render the purchase
   * section. Implies `withLinks` for social accounts.
   */
  purchaseChannel?: 'website' | 'myship';
  /**
   * Seed the brand evidence the FAQ presets gate their template floors on, so
   * a fixture renders several FAQ items. `taiwan-origin` requires a verified
   * `mit_status` and is intentionally absent from this declared fixture:
   *   - `main-products`  — needs `subcategories` (and `subcategories_en` for /en).
   *   - `price-positioning` — needs `price_range` (smallint ordinal 1/2/3).
   *   - `reputation`     — needs `reputation_summary.text`; deliberately left
   *     unseeded, since no e2e journey asserts on it and it is the one field
   *     whose copy is model-authored rather than template-derived.
   *   - `custom`         — model-authored only, no template floor to seed for.
   *
   * Opt-in and default-off on purpose: many specs share `seedBrand`, and these
   * columns change the rendered header badge, subcategories, and price row.
   */
  withFaqEvidence?: boolean;
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
    ...(status === 'approved' ? { approved_at: new Date().toISOString() } : {}),
    category: 'crafts',
    founding_year: '2020',
  };

  if (opts.withFaqEvidence) {
    // 'declared' (not 'verified') intentionally suppresses the taiwan-origin
    // template floor; a self-declaration needs no registry match, so the
    // fixture stays valid without seeding MIT registry rows.
    brandData.mit_status = 'declared';
    brandData.mit_declared_scope = 'all';
    // Slugs, not zh-TW labels: DEV-1510 made `subcategories` slug-native and
    // closed the vocabulary, so `approve_submission` now raises on any string
    // that resolves to no slug, alias or recorded removal. Both are crafts-native
    // to match `category` above — the old '茶具' resolves to `tea-and-coffee-ware`,
    // which lives under `home`, and a cross-L1 tag is exactly the state DEV-1510
    // measured as unusable for facets and L2 pages.
    brandData.subcategories = ['ceramics', 'metalwork'];
    brandData.subcategories_en = ['Ceramics', 'Metalwork'];
    brandData.price_range = 2;
  }

  if (opts.withLinks) {
    brandData.social_instagram = 'https://instagram.com/e2e-test';
    brandData.social_facebook = 'https://facebook.com/e2e-test';
    if ((opts.purchaseChannel ?? 'website') === 'myship') {
      brandData.purchase_myship = 'https://myship.7-11.com.tw/general/detail/GM2410161234567';
    } else {
      brandData.purchase_website = 'https://e2e-test.com/shop';
    }
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
    if (error) throw new Error(`[e2e-cleanup] seed brand ${brand.id} cleanup failed: ${error.message}`);
  };

  return { brand, slug, cleanup };
}
