import { isoDateInTimeZone } from "@/lib/date-range";
import type { HomepageCuratedProduct } from "@/lib/services/curated-products";
import { MAX_HOME_CURATED_PRODUCTS_PER_BRAND } from "@/lib/services/curated-products";
import type { TrailEntry } from "@/lib/services/trails";

export const MAX_HOME_WALL_PRODUCTS = 32;
export const TRAIL_SLOT_CADENCE = 8;
export const DIVERSITY_WINDOW_SIZE = 12;
export const MAX_PRODUCTS_PER_L1_IN_DIVERSITY_WINDOW = 6;

/**
 * The wall rotates on the Taipei calendar day, because that is the day its
 * readers are having. A UTC seed would turn the wall over at 08:00 local.
 * Declared here rather than imported from `@/lib/services/events` on purpose:
 * that module opens a Supabase service client at import time, and this one is
 * pure by design so the composition can be tested with no I/O at all.
 */
const WALL_TIME_ZONE = "Asia/Taipei";

/**
 * The four shapes a product tile may take. Every image is SNAPPED to the
 * nearest of them rather than rendered at its own ratio: brand images are
 * capped at 3:1 at ingest and curated-product images are not, so an unsnapped
 * wall renders a sale banner or a spec sheet as a strip across the grid.
 */
export const WALL_RATIOS = {
  "1:1": 1,
  "3:4": 3 / 4,
  "4:3": 4 / 3,
  "4:5": 4 / 5,
} as const;

export type WallRatio = keyof typeof WALL_RATIOS;

/** What an unmeasured row renders as. NULL dimensions are the backfill cursor. */
export const DEFAULT_WALL_RATIO: WallRatio = "4:3";

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

export type BuildWallSlotsResult = {
  slots: WallSlot[];
  leftoverTrails: TrailEntry[];
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

function isPinned(product: HomepageCuratedProduct): boolean {
  return product.wallPosition !== null && product.wallPosition !== undefined;
}

function capProductsPerBrand(
  products: HomepageCuratedProduct[],
): HomepageCuratedProduct[] {
  const counts = new Map<string, number>();
  return products.filter((product) => {
    const count = counts.get(product.brandId) ?? 0;
    if (count >= MAX_HOME_CURATED_PRODUCTS_PER_BRAND) return false;
    counts.set(product.brandId, count + 1);
    return true;
  });
}

function applyDiversityPass(
  products: HomepageCuratedProduct[],
): HomepageCuratedProduct[] {
  const firstWindow: HomepageCuratedProduct[] = [];
  const deferred: HomepageCuratedProduct[] = [];
  const counts = new Map<string, number>();

  for (const product of products) {
    if (firstWindow.length >= DIVERSITY_WINDOW_SIZE) {
      deferred.push(product);
      continue;
    }

    const count = counts.get(product.l1) ?? 0;
    if (count >= MAX_PRODUCTS_PER_L1_IN_DIVERSITY_WINDOW) {
      deferred.push(product);
      continue;
    }

    firstWindow.push(product);
    counts.set(product.l1, count + 1);
  }

  return [...firstWindow, ...deferred];
}

/**
 * Pins first, then the day's shuffle.
 *
 * `wall_position` survives the removal of the editorial anchor spans as a PIN:
 * a product carrying one sorts ahead of everything else, in its own order, so
 * an editor can still force something to the top of the wall. Everything
 * unpinned is shuffled on the date seed. The diversity pass runs on the
 * shuffled tail only — a pin that the pass deferred would not be a pin.
 */
function orderProducts(
  products: HomepageCuratedProduct[],
  seed: string,
): HomepageCuratedProduct[] {
  const pinned = products.filter(isPinned).sort(
    (a, b) =>
      (a.wallPosition ?? 0) - (b.wallPosition ?? 0) ||
      a.brandSlug.localeCompare(b.brandSlug) ||
      a.key.localeCompare(b.key),
  );
  const shuffled = shuffleWithSeed(products.filter((p) => !isPinned(p)), seed);

  // The per-brand cap runs over the pinned stream FIRST, so a pin always wins
  // the brand's two places rather than losing them to a shuffled sibling.
  const capped = capProductsPerBrand([...pinned, ...shuffled]);
  return [
    ...capped.filter(isPinned),
    ...applyDiversityPass(capped.filter((p) => !isPinned(p))),
  ];
}

function eligibleTrail(trail: TrailEntry): boolean {
  return Boolean(trail.frontmatter.heroImage?.trim());
}

/** Composes the finite wall: pins, then the day's shuffle, then the trails. */
export function buildWallSlots({
  products,
  trails,
  seed = wallSeedForDate(),
}: BuildWallSlotsInput): BuildWallSlotsResult {
  const editorialProducts = orderProducts(products, seed).slice(
    0,
    MAX_HOME_WALL_PRODUCTS,
  );
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

  const placedTrailSlugs = new Set(reservedTrails.map((trail) => trail.slug));
  return {
    slots,
    leftoverTrails: trails.filter((trail) => !placedTrailSlugs.has(trail.slug)),
  };
}
