/**
 * Leaf module: the runtime values the product wall's TILES need, with no
 * service-layer imports and no I/O of any kind.
 *
 * It exists because a client component (`selected-product-tile`) needs
 * `DEFAULT_WALL_RATIO` at runtime. Importing it from `home-wall` — or from
 * `@/lib/services/curated-products` — drags the service layer, and through it
 * `sharp`, into the client bundle. Keep this file free of every import that is
 * not a type declared in the same directory.
 */

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

/** Keep one brand from owning three of the first eight wall tiles. */
export const MAX_HOME_CURATED_PRODUCTS_PER_BRAND = 2;
