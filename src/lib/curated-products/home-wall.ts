import type { HomepageCuratedProduct } from "@/lib/services/curated-products";
import { MAX_HOME_CURATED_PRODUCTS_PER_BRAND } from "@/lib/services/curated-products";
import type { TrailEntry } from "@/lib/services/trails";

export const MAX_HOME_WALL_PRODUCTS = 32;
export const TRAIL_SLOT_CADENCE = 8;
export const MAX_HOME_WALL_ANCHOR_RATIO = 0.25;
export const DIVERSITY_WINDOW_SIZE = 12;
export const MAX_PRODUCTS_PER_L1_IN_DIVERSITY_WINDOW = 6;

export type WallSpan = "1x1" | "2x1" | "2x2";

export type WallProductSlot = {
  kind: "product";
  product: HomepageCuratedProduct;
  span: WallSpan;
};

export type WallTrailSlot = {
  kind: "trail";
  trail: TrailEntry;
  span: "2x2";
};

export type WallSlot = WallProductSlot | WallTrailSlot;

export type BuildWallSlotsInput = {
  products: HomepageCuratedProduct[];
  trails: TrailEntry[];
};

export type BuildWallSlotsResult = {
  slots: WallSlot[];
  leftoverTrails: TrailEntry[];
};

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

function anchorSpans(products: HomepageCuratedProduct[]): Map<string, WallSpan> {
  const maxAnchors = Math.floor(
    products.length * MAX_HOME_WALL_ANCHOR_RATIO,
  );
  const placed = products
    .filter((product) => product.wallPosition !== null && product.wallPosition !== undefined)
    .sort(
      (a, b) =>
        (a.wallPosition ?? Number.MAX_SAFE_INTEGER) -
          (b.wallPosition ?? Number.MAX_SAFE_INTEGER) ||
        a.brandSlug.localeCompare(b.brandSlug) ||
        a.key.localeCompare(b.key),
    )
    .slice(0, maxAnchors);

  return new Map(
    placed.map((product, index) => [
      product.id,
      index === 0 ? ("2x2" as const) : ("2x1" as const),
    ]),
  );
}

function eligibleTrail(trail: TrailEntry): boolean {
  return Boolean(trail.frontmatter.heroImage?.trim());
}

/** Composes the finite wall without changing the order of its product stream. */
export function buildWallSlots({
  products,
  trails,
}: BuildWallSlotsInput): BuildWallSlotsResult {
  const cappedProducts = capProductsPerBrand(products);
  const editorialProducts = applyDiversityPass(cappedProducts).slice(
    0,
    MAX_HOME_WALL_PRODUCTS,
  );
  const spans = anchorSpans(editorialProducts);
  const eligibleTrails = trails.filter(eligibleTrail);
  const trailSlotCount = Math.min(
    Math.floor(editorialProducts.length / TRAIL_SLOT_CADENCE),
    eligibleTrails.length,
  );
  const reservedTrails = eligibleTrails.slice(0, trailSlotCount);
  const reservedSlots = new Map<number, TrailEntry>();
  reservedTrails.forEach((trail, index) => {
    reservedSlots.set(
      (index + 1) * TRAIL_SLOT_CADENCE + index,
      trail,
    );
  });

  const slots: WallSlot[] = [];
  let productIndex = 0;
  let slotIndex = 0;
  while (productIndex < editorialProducts.length || reservedSlots.has(slotIndex)) {
    const reservedTrail = reservedSlots.get(slotIndex);
    if (reservedTrail) {
      slots.push({ kind: "trail", trail: reservedTrail, span: "2x2" });
    } else {
      const product = editorialProducts[productIndex];
      if (!product) break;
      slots.push({
        kind: "product",
        product,
        span: spans.get(product.id) ?? "1x1",
      });
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
