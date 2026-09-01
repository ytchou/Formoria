import { isoDateInTimeZone } from "@/lib/date-range";
import type { HomepageCuratedProduct } from "@/lib/services/curated-products";
import {
  DEFAULT_WALL_RATIO,
  WALL_RATIOS,
  type WallRatio,
} from "@/lib/curated-products/wall-ratio";
import { VISIBLE_L1_CATEGORIES } from "@/lib/taxonomy/ontology";

/**
 * Re-exported so existing importers of this module keep working. The values
 * are DECLARED in `./wall-ratio`, which is a leaf with no service imports —
 * client components must import them from there, not from here.
 */
export { DEFAULT_WALL_RATIO, WALL_RATIOS, type WallRatio };

/**
 * FOUR desktop lines of four, not eight.
 *
 * Sized in LINES, because that is what a reader perceives: 32 products ran the
 * wall to eight lines and ~3000px, which buried every section under it.
 *
 * The figure is both the product cap and the maximum slot count. `ProductWall`
 * trims partial supply back to a whole desktop line so an orphan does not
 * stretch across the full measure.
 */
export const MAX_HOME_WALL_PRODUCTS = 16;

/** Two complete rows in the dark-overlay grid's five-column desktop layout. */
export const MAX_HOME_GRID_PRODUCTS = 10;

/**
 * The wall rotates on the Taipei calendar day, because that is the day its
 * readers are having. A UTC seed would turn the wall over at 08:00 local.
 * Declared here rather than derived from a shared constant: this module is
 * pure by design so the composition can be tested with no I/O at all.
 */
const WALL_TIME_ZONE = "Asia/Taipei";

export type WallProductSlot = {
  product: HomepageCuratedProduct;
  ratio: WallRatio;
};

export type WallSlot = WallProductSlot;

export type BuildWallSlotsInput = {
  products: HomepageCuratedProduct[];
  /**
   * The day the wall is being composed for, as `YYYY-MM-DD`. Passed in so the
   * composition is a pure function of its arguments; defaulted so callers that
   * only want "today in Taipei" do not have to say so.
   */
  seed?: string;
};

/** The Taipei calendar day, which is the whole of the wall's daily seed. */
export function wallSeedForDate(now: Date = new Date()): string {
  return isoDateInTimeZone(now.toISOString(), WALL_TIME_ZONE);
}

/**
 * Snaps a measured image to its nearest bucket.
 *
 * Nearest by absolute ratio distance: 4:5 (0.8) and 3:4 (0.75) are close
 * enough that anything looser puts most portrait photography in one bucket.
 * A missing or nonsensical measurement falls back rather than guessing — the
 * row is simply not backfilled yet.
 */
export function wallRatioFor(
  product: Pick<HomepageCuratedProduct, "imageWidth" | "imageHeight">,
): WallRatio {
  const width = product.imageWidth;
  const height = product.imageHeight;
  if (!width || !height || width <= 0 || height <= 0) return DEFAULT_WALL_RATIO;

  const measured = width / height;
  let best: WallRatio = DEFAULT_WALL_RATIO;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const [name, value] of Object.entries(WALL_RATIOS) as [
    WallRatio,
    number,
  ][]) {
    const distance = Math.abs(measured - value);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = name;
    }
  }
  return best;
}

/** FNV-1a: a seed string in, a 32-bit state out. */
function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32: small, fast, and deterministic — the whole requirement here. */
function seededRandom(seed: string): () => number {
  let state = hashSeed(seed) || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * PURE. A function of `(items, seed)` and nothing else — no clock, no
 * `Math.random`, no I/O. Per-request randomness would force `/` dynamic and
 * cost the site its ISR shell; a date seed rotates the wall exactly once a day
 * inside the existing revalidation window.
 */
export function shuffleWithSeed<T>(items: readonly T[], seed: string): T[] {
  const next = seededRandom(seed);
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(next() * (index + 1));
    const current = shuffled[index]!;
    shuffled[index] = shuffled[swap]!;
    shuffled[swap] = current;
  }
  return shuffled;
}

/**
 * Keeps at most `MAX_HOME_CURATED_PRODUCTS_PER_BRAND` per brand.
 *
 * Runs AFTER the shuffle, never before it: capping the read would freeze which
 * two of a brand's products the wall can ever show, and the daily rotation is
 * the whole reason a brand with four products is not reduced to the same two
 * every day.
 */
function capProductsPerBrand(
  products: HomepageCuratedProduct[],
): HomepageCuratedProduct[] {
  const selected = new Set<HomepageCuratedProduct>();
  const byBrand = new Map<string, HomepageCuratedProduct[]>();
  for (const product of products) {
    const brandProducts = byBrand.get(product.brandId) ?? [];
    brandProducts.push(product);
    byBrand.set(product.brandId, brandProducts);
  }
  for (const brandProducts of byBrand.values()) {
    const first = brandProducts[0];
    if (!first) continue;
    selected.add(first);
    const second =
      brandProducts.find(
        (product) => product.subcategory !== first.subcategory,
      ) ?? brandProducts[1];
    if (second) selected.add(second);
  }
  return products.filter((product) => selected.has(product));
}

/**
 * Composes the finite wall: the day's shuffle, then the per-brand cap, then the
 * slice to `MAX_HOME_WALL_PRODUCTS`. That is the whole ordering — the seed
 * decides everything about which products lead the wall, and no editorial
 * override sits above it.
 *
 * NO CATEGORY-SPREAD PASS (removed DEV-1496). A per-L1 window over the first
 * twelve tiles reordered the wall to satisfy a budget no reader was counting,
 * and it fought the one rule that DOES earn its place — the daily rotation. A
 * wall of sixteen `home` products is simply what a day of `home` supply looks
 * like.
 *
 */
export function buildWallSlots({
  products,
  seed = wallSeedForDate(),
}: BuildWallSlotsInput): WallSlot[] {
  return capProductsPerBrand(shuffleWithSeed(products, seed))
    .slice(0, MAX_HOME_WALL_PRODUCTS)
    .map((product) => ({ product, ratio: wallRatioFor(product) }));
}

export type GroupedWallSlots = Record<string, WallSlot[]>;

export function buildGroupedWallSlots({
  products,
  seed = wallSeedForDate(),
}: BuildWallSlotsInput): GroupedWallSlots {
  const allSlots = buildWallSlots({ products, seed }).slice(
    0,
    MAX_HOME_GRID_PRODUCTS,
  );

  const groups: GroupedWallSlots = { all: allSlots };

  for (const category of VISIBLE_L1_CATEGORIES) {
    const filtered = products.filter((p) => p.category === category.slug);
    groups[category.slug] = buildWallSlots({ products: filtered, seed }).slice(
      0,
      MAX_HOME_GRID_PRODUCTS,
    );
  }

  return groups;
}
