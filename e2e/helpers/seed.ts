import { createClient, SupabaseClient } from "@supabase/supabase-js";

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
  status?: "approved" | "hidden";
  workerIndex: number;
  withLinks?: boolean;
  /**
   * Seed a brand whose ONLY purchase channel is 7-ELEVEN 賣貨便 (`purchase_myship`),
   * with `purchase_website` left NULL. Covers the case a website-centric fixture
   * cannot: that a non-website channel alone is enough to render the purchase
   * section. Implies `withLinks` for social accounts.
   */
  onlineStore?: "website" | "myship";
  /**
   * Seed the brand evidence the FAQ presets gate their template floors on, so
   * a fixture renders several FAQ items:
   *   - `main-products`  — needs `subcategories` (and `subcategories_en` for /en).
   *   - `reputation`     — needs `reputation_summary.text`; deliberately left
   *     unseeded, since no e2e journey asserts on it and it is the one field
   *     whose copy is model-authored rather than template-derived.
   *   - `custom`         — model-authored only, no template floor to seed for.
   *
   * Opt-in and default-off on purpose: many specs share `seedBrand`, and these
   * columns change the rendered subcategories.
   */
  withFaqEvidence?: boolean;
}): Promise<SeededBrand> {
  const supabase = getServiceClient();
  const ts = Date.now();
  const status = opts.status ?? "approved";
  const slug = `e2e-${opts.name}-${ts}-${opts.workerIndex}`;
  const fullName = `[E2E-TEST] ${opts.name} ${ts}`;

  const brandData: Record<string, unknown> = {
    name: fullName,
    slug,
    status,
    ...(status === "approved" ? { approved_at: new Date().toISOString() } : {}),
    category: "home",
    founding_year: "2020",
  };

  if (opts.withFaqEvidence) {
    // Slugs, not zh-TW labels: DEV-1510 made `subcategories` slug-native and
    // closed the vocabulary, so `approve_submission` now raises on any string
    // that resolves to no slug, alias or recorded removal. Both are home-native
    // to match `category` above — DEV-1507 retired `crafts`, so the old
    // ['ceramics', 'metalwork'] pair now spans two L1s and neither one is the
    // seeded L1, and a cross-L1 tag is exactly the state DEV-1510 measured as
    // unusable for facets and L2 pages.
    brandData.subcategories = ["tableware", "storage"];
    brandData.subcategories_en = ["Tableware", "Storage"];
  }

  if (opts.withLinks) {
    brandData.social_instagram = "https://instagram.com/e2e-test";
    brandData.social_facebook = "https://facebook.com/e2e-test";
    if ((opts.onlineStore ?? "website") === "myship") {
      brandData.purchase_myship =
        "https://myship.7-11.com.tw/general/detail/GM2410161234567";
    } else {
      brandData.purchase_website = "https://e2e-test.com/shop";
    }
  }

  const { data: brand, error } = await supabase
    .from("brands")
    .insert(brandData)
    .select()
    .single();

  if (error || !brand) {
    throw new Error(
      `seedBrand insert failed: ${error?.message} (code: ${error?.code}, details: ${error?.details})`,
    );
  }

  const cleanup = async () => {
    const { error } = await supabase.from("brands").delete().eq("id", brand.id);
    if (error)
      throw new Error(
        `[e2e-cleanup] seed brand ${brand.id} cleanup failed: ${error.message}`,
      );
  };

  return { brand, slug, cleanup };
}
