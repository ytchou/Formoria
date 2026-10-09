/**
 * Result diversification for the served /discover?q= ranking (DEV-1991).
 *
 * Pure reordering — nothing is dropped. Within the first DIVERSITY_WINDOW
 * slots a near-duplicate SKU family appears at most once (and a brand at most
 * MAX_PER_BRAND_IN_WINDOW times — currently uncapped, see below). Demoted
 * items keep their relative order and sit directly after the window, ahead of
 * lower-ranked items.
 *
 * Shortcut: name-based family detection (SKU-code stripping). Ceiling:
 * variants whose names differ in words, not codes, are not grouped — e.g.
 * opus's heart-fingerprint plate TW-he12 and black-bear plate TW-be06 stay
 * apart. Upgrade path: a product-family id assigned at curation time.
 *
 * Brand cap off (2026-10-09). Staging, situation-search-v3 holdout, 40
 * queries, hybrid, LTR off; same-day run with diversification fully off was
 * NDCG@10 0.770 / P@5 0.640 / keyword NDCG 0.816:
 *   cap 2 in top 8: 0.751 / 0.620 / 0.763
 *   cap 3 in top 8: 0.763 / 0.640 / 0.796
 *   cap 2 in top 5: 0.763 / 0.620 / 0.792
 *   no brand cap:   0.770 / 0.640 / 0.816 (the family rule alone is neutral)
 * The golden labels grade items independently, so a query whose relevant set
 * is one brand's line scores lower when that brand is spread out. Upgrade
 * path: labels that penalize redundancy (e.g. alpha-NDCG), then re-tune the
 * cap through the `maxPerBrand` option.
 */

export const DIVERSITY_WINDOW = 8;
export const MAX_PER_BRAND_IN_WINDOW = Number.POSITIVE_INFINITY;

type Diversifiable = {
  brandSlug: string;
  brandName: string;
  nameZh: string;
};

/** Latin/digit runs, optionally dash-joined: `TW-he12`, `710ml`, `SV925`. */
const LATIN_TOKEN = /[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*/g;
/** Bracketed asides: double-angle, black-lenticular, corner, and (full-width) round/square brackets. */
const BRACKETED =
  /\u300A[^\u300B]*\u300B|\u3010[^\u3011]*\u3011|\u300C[^\u300D]*\u300D|\([^)]*\)|\uFF08[^\uFF09]*\uFF09|\[[^\]]*\]/g;
const NON_WORD = /[^\p{L}\p{N}]+/gu;

function fold(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(NON_WORD, "");
}

/**
 * Brand-scoped near-duplicate key for one product: the name with SKU-like
 * tokens (any Latin run containing a digit, e.g. `TW-he12`, `710ml`),
 * bracketed asides, and punctuation removed. Null when nothing is left.
 */
export function productFamilyKey(product: Diversifiable): string | null {
  const name = product.nameZh.normalize("NFKC");
  let stem = fold(
    name
      .replace(BRACKETED, " ")
      .replace(LATIN_TOKEN, (token) => (/\d/.test(token) ? " " : token)),
  );
  // "Name710ml Name710ml" — a listing that repeats its own name.
  const half = stem.length / 2;
  if (stem.length > 0 && stem.length % 2 === 0 && stem.slice(0, half) === stem.slice(half)) {
    stem = stem.slice(0, half);
  }

  return stem ? `${product.brandSlug}|${stem}` : null;
}

/** True when the query names the brand, by name or slug — a navigational query. */
function queryNamesBrand(foldedQuery: string, product: Diversifiable): boolean {
  if (foldedQuery.length < 2) return false;
  const name = fold(product.brandName);
  if (name.length >= 2 && foldedQuery.includes(name)) return true;
  const slug = fold(product.brandSlug);
  return slug.length >= 3 && foldedQuery.includes(slug);
}

/**
 * Returns a permutation of `ranked`'s indices: the diversified order. Callers
 * apply it to the products and to any slot-aligned arrays (armBySlot).
 * Brands the query names are exempt.
 */
export function diversifyRankedProducts(
  ranked: readonly Diversifiable[],
  opts: { query: string; window?: number; maxPerBrand?: number },
): number[] {
  const window = Math.min(opts.window ?? DIVERSITY_WINDOW, ranked.length);
  const maxPerBrand = opts.maxPerBrand ?? MAX_PER_BRAND_IN_WINDOW;
  const foldedQuery = fold(opts.query);

  const picked: number[] = [];
  const deferred: number[] = [];
  const brandCount = new Map<string, number>();
  const usedFamilies = new Set<string>();

  let index = 0;
  for (; index < ranked.length && picked.length < window; index += 1) {
    const product = ranked[index]!;
    if (queryNamesBrand(foldedQuery, product)) {
      picked.push(index);
      continue;
    }
    const family = productFamilyKey(product);
    const count = brandCount.get(product.brandSlug) ?? 0;
    if (count >= maxPerBrand || (family !== null && usedFamilies.has(family))) {
      deferred.push(index);
      continue;
    }
    picked.push(index);
    brandCount.set(product.brandSlug, count + 1);
    if (family !== null) usedFamilies.add(family);
  }

  const rest: number[] = [];
  for (; index < ranked.length; index += 1) rest.push(index);
  return [...picked, ...deferred, ...rest];
}
