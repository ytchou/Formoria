import { isoDateInTimeZone } from "@/lib/date-range";
import type { HomepageCuratedProduct } from "@/lib/services/curated-products";
import {
  DEFAULT_WALL_RATIO,
  MAX_HOME_CURATED_PRODUCTS_PER_BRAND,
  WALL_RATIOS,
  type WallRatio,
} from "@/lib/curated-products/wall-ratio";
import type { TrailEntry } from "@/lib/services/trails";

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
 * The figure is the PRODUCT cap, not the slot count. At a cadence of 8 a full
 * wall earns TWO trail slots, so it composes to 18 slots — not the 17 this
 * comment claimed while the cap was smaller — and `ProductWall` trims back to a
 * whole 16. That trim takes its overflow from the tail's products so neither
 * reserved trail is discarded. That is now a COMPOSITION rule, not a
 * content-loss rule: the homepage trails zone renders every indexable trail
 * whether or not the wall placed it, so a trimmed trail would still reach the
 * reader. Products are the interchangeable part of the wall, which is the
 * reason the trim keeps taking its overflow from them.
 */
export const MAX_HOME_WALL_PRODUCTS = 16;
export const TRAIL_SLOT_CADENCE = 8;

/**
 * The wall rotates on the Taipei calendar day, because that is the day its
 * readers are having. A UTC seed would turn the wall over at 08:00 local.
 * Declared here rather than imported from `@/lib/services/events` on purpose:
 * that module opens a Supabase service client at import time, and this one is
 * pure by design so the composition can be tested with no I/O at all.
 */
const WALL_TIME_ZONE = "Asia/Taipei";

/**
 * Trail tiles are sized editorially, never measured: the tile carries a title
 * and a line of copy over a hero image, so its shape is a layout decision.
 */
export type WallTrailFormat = "tall" | "wide";

export type WallProductSlot = {
  kind: "product";
  product: HomepageCuratedProduct;
  ratio: WallRatio;
};

export type WallTrailSlot = {
  kind: "trail";
  trail: TrailEntry;
  format: WallTrailFormat;
};

export type WallSlot = WallProductSlot | WallTrailSlot;

export type BuildWallSlotsInput = {
  products: HomepageCuratedProduct[];
  trails: TrailEntry[];
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
  const counts = new Map<string, number>();
  const kept: HomepageCuratedProduct[] = [];

  for (const product of products) {
    const count = counts.get(product.brandId) ?? 0;
    if (count >= MAX_HOME_CURATED_PRODUCTS_PER_BRAND) continue;
    counts.set(product.brandId, count + 1);
    kept.push(product);
  }

  return kept;
}

function eligibleTrail(trail: TrailEntry): boolean {
  return Boolean(trail.frontmatter.heroImage?.trim());
}

/**
 * Composes the finite wall: the day's shuffle, then the per-brand cap, then the
 * slice to `MAX_HOME_WALL_PRODUCTS`, then the trail interleave. That is the
 * whole ordering — the seed decides everything about which products lead the
 * wall, and no editorial override sits above it.
 *
 * NO CATEGORY-SPREAD PASS (removed DEV-1496). A per-L1 window over the first
 * twelve tiles reordered the wall to satisfy a budget no reader was counting,
 * and it fought the one rule that DOES earn its place — the daily rotation. A
 * wall of sixteen `home` products is simply what a day of `home` supply looks
 * like.
 */
export function buildWallSlots({
  products,
  trails,
  seed = wallSeedForDate(),
}: BuildWallSlotsInput): WallSlot[] {
  const editorialProducts = capProductsPerBrand(
    shuffleWithSeed(products, seed),
  ).slice(0, MAX_HOME_WALL_PRODUCTS);
  const eligibleTrails = trails.filter(eligibleTrail);
  const trailSlotCount = Math.min(
    Math.floor(editorialProducts.length / TRAIL_SLOT_CADENCE),
    eligibleTrails.length,
  );
  const reservedTrails = eligibleTrails.slice(0, trailSlotCount);
  const reservedSlots = new Map<number, TrailEntry>();
  const trailFormats = new Map<string, WallTrailFormat>();
  reservedTrails.forEach((trail, index) => {
    reservedSlots.set((index + 1) * TRAIL_SLOT_CADENCE + index, trail);
    // Alternating so two trail tiles never read as a repeated module.
    trailFormats.set(trail.slug, index % 2 === 0 ? "tall" : "wide");
  });

  const slots: WallSlot[] = [];
  let productIndex = 0;
  let slotIndex = 0;
  while (productIndex < editorialProducts.length || reservedSlots.has(slotIndex)) {
    const reservedTrail = reservedSlots.get(slotIndex);
    if (reservedTrail) {
      slots.push({
        kind: "trail",
        trail: reservedTrail,
        format: trailFormats.get(reservedTrail.slug) ?? "tall",
      });
    } else {
      const product = editorialProducts[productIndex];
      if (!product) break;
      slots.push({ kind: "product", product, ratio: wallRatioFor(product) });
      productIndex += 1;
    }
    slotIndex += 1;
  }

  return slots;
}
