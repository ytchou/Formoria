/**
 * @formoria-script
 * purpose: Lists every brand where two or more visible curated products share one stored image (same content-hash filename).
 * class: validator
 * invoke: pnpm exec tsx scripts/enrichment/products/curated-products/find-shared-images.ts
 * target: staging-default
 * safety: read-only
 * owner: engineering
 * notes: BD-04. Never writes; --target=production is a read-only census.
 */
import { curatedImageIdentity } from "@/lib/services/curated-products";
import { createServiceClient } from "@/lib/supabase/service";

import { loadScriptTarget } from "../../../shared/target";
import { fetchAllRows, parseBrandOption } from "./shared";

/**
 * Finds the data behind BD-04: different curated products that point at the
 * same mirrored image, so a chopstick tile shows a pen box. Mirrored files are
 * named by content hash, so the last path segment of `image_url` is the image's
 * identity (`curatedImageIdentity`, the same function the brand-page guard in
 * `toBrandPageOrder` uses — the census and the guard cannot disagree).
 *
 *   pnpm exec tsx scripts/enrichment/products/curated-products/find-shared-images.ts
 *   …--brand=<slug>          scope the run to one brand
 *   …--target=production     defaults to staging; see scripts/shared/target.ts
 *
 * Output: one JSON line per shared image (brand slug, identity, product keys
 * and names in brand-page order), then a summary line. The first product keeps
 * the photo on the public page; every later one is hidden by the guard until
 * it is re-collected with its own photo.
 *
 * Shortcut, with its ceiling: the read gate is `visible` + a stored image, not
 * the full public proof gate (active source, checked sources). That is a
 * superset of what renders, so it can list a pair the public page never shows
 * together. Fine for a data audit — the hidden row still needs its own photo
 * before it can publish. Upgrade path if the noise matters: add the
 * `curated_product_sources!inner` active-state filter from
 * `readPublishedCuratedProducts`.
 */

const PAGE_SIZE = 1000;

export type SharedImageRow = {
  id: string;
  key: string;
  name_zh: string;
  image_url: string | null;
  product_position: number | null;
  created_at: string;
  /** PostgREST returns a to-one embed as an object here and an array elsewhere. */
  brands?: { slug: string } | { slug: string }[] | null;
};

export type SharedImageGroup = {
  brandSlug: string;
  imageIdentity: string;
  products: { key: string; nameZh: string; imageUrl: string }[];
};

function brandSlugOf(row: SharedImageRow): string | null {
  const brands = Array.isArray(row.brands) ? row.brands[0] : row.brands;
  return brands?.slug ?? null;
}

/** Brand-page order, matching `compareBrandPageOrder` in the service. */
const UNPLACED = Number.MAX_SAFE_INTEGER;
const compareBrandPageOrder = (a: SharedImageRow, b: SharedImageRow): number =>
  (a.product_position ?? UNPLACED) - (b.product_position ?? UNPLACED) ||
  a.created_at.localeCompare(b.created_at) ||
  a.key.localeCompare(b.key);

/**
 * Groups rows by (brand, image identity) and returns only the groups with two
 * or more products, products in brand-page order, groups sorted by brand slug
 * then identity. Rows without an image or a brand are ignored. Never groups
 * across brands.
 */
export function groupSharedImages(
  rows: readonly SharedImageRow[],
): SharedImageGroup[] {
  const groups = new Map<string, SharedImageGroup & { rows: SharedImageRow[] }>();
  for (const row of rows) {
    const brandSlug = brandSlugOf(row);
    if (!row.image_url || !brandSlug) continue;
    const imageIdentity = curatedImageIdentity(row.image_url);
    const slot = `${brandSlug}\u0000${imageIdentity}`;
    const group = groups.get(slot) ?? {
      brandSlug,
      imageIdentity,
      products: [],
      rows: [],
    };
    group.rows.push(row);
    groups.set(slot, group);
  }
  return [...groups.values()]
    .filter((group) => group.rows.length >= 2)
    .map(({ brandSlug, imageIdentity, rows: groupRows }) => ({
      brandSlug,
      imageIdentity,
      products: [...groupRows].sort(compareBrandPageOrder).map((row) => ({
        key: row.key,
        nameZh: row.name_zh,
        imageUrl: row.image_url as string,
      })),
    }))
    .sort(
      (a, b) =>
        a.brandSlug.localeCompare(b.brandSlug) ||
        a.imageIdentity.localeCompare(b.imageIdentity),
    );
}

async function loadRows(brandSlug: string | null): Promise<SharedImageRow[]> {
  const supabase = createServiceClient();
  return fetchAllRows<SharedImageRow>(
    "curated_products",
    (from, to) => {
      let query = supabase
        .from("curated_products")
        .select(
          "id, key, name_zh, image_url, product_position, created_at, brands!inner(slug)",
        )
        .eq("visible", true)
        .not("image_url", "is", null);
      if (brandSlug) query = query.eq("brands.slug", brandSlug);
      // Stable order, or two pages can repeat one row and skip another.
      return query.order("id", { ascending: true }).range(from, to);
    },
    PAGE_SIZE,
  );
}

async function main(): Promise<void> {
  const { target, argv } = loadScriptTarget();
  const brandSlug = parseBrandOption(argv);
  const rows = await loadRows(brandSlug);
  const groups = groupSharedImages(rows);
  for (const group of groups) console.log(JSON.stringify(group));
  const brands = new Set(groups.map((group) => group.brandSlug));
  console.log(
    JSON.stringify({
      target,
      scannedProducts: rows.length,
      sharedImages: groups.length,
      brands: brands.size,
      // Every product after the first in a group is hidden by the guard.
      surplusProducts: groups.reduce(
        (sum, group) => sum + group.products.length - 1,
        0,
      ),
    }),
  );
}

// The test imports the pure function from this module, so importing it must
// never start a run. `main()` fires only when this file IS the process entry.
if (process.argv[1]?.endsWith("curated-products/find-shared-images.ts")) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
