import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import type { Database } from "@/lib/supabase/database.types";
import { auditedCall, type AuditCallContext } from "@/lib/audit";
import { reportBannedTerms } from "@/lib/i18n/banned-terms";
import type { BrandVisitLinkFields } from "@/lib/brands/link-fallback";
import type { ExistingCuratedProduct } from "@/lib/services/curated-products/proposal-diff";
import { withSlugSuffix } from "@/lib/brands/slug";
import { generateSlug } from "@/lib/services/brands";
import { normalizeSubcategories } from "@/lib/services/subcategories";
import {
  excludeTestBrands,
  TEST_BRAND_NAME_PREFIX,
} from "@/lib/services/public-brand-filter";
import {
  materialBySlug,
  resolveSubcategorySlugs,
} from "@/lib/taxonomy/ontology";
import { getPublishedTrailBySlug, getTrailBySlug } from "@/lib/services/trails";

/** The tables are reached through the untyped `from` surface, with generated DB shapes at the boundary. */
export type CuratedProductSupabase = Pick<SupabaseClient, "from">;

/**
 * One curated product as the brand page renders it: the product itself plus the
 * single selection that says WHERE it sits on a trail.
 *
 * ONE text field, `productDescription*` (DEV-1496). The three that preceded it
 * — a product note, a brand-page highlight rationale, and a per-placement
 * selection rationale — collapsed into it, so no caller needs a `??` chain to
 * decide which of three columns a surface should render.
 *
 * `linkState` is reported, never filtered on. A broken link suppresses the
 * call-to-action; it does not unpublish the product, so the decision belongs to
 * the component and not to this query.
 */
export type CuratedProduct = {
  id: string;
  brandId: string;
  key: string;
  nameZh: string;
  nameEn: string | null;
  category: string;
  subcategories: string[];
  officialUrl: string | null;
  imageUrl: string | null;
  imageSourceUrl: string | null;
  /** Public visibility. `false` is a withdrawal, never a delete. */
  visible: boolean;
  linkState: string;
  linkCheckedAt: string | null;
  sourceCheckedAt: string | null;
  reviewDueAt: string | null;
  /** The one piece of editorial copy a product carries. NOT NULL in Postgres. */
  productDescriptionZh: string;
  productDescriptionEn: string | null;
  /** Where the product sits in its own brand page's selection. */
  productPosition: number | null;
  createdAt: string;
  /** The winning selection: lowest `position`, ties broken by `trailSlug`. */
  trailSlug: string | null;
  sectionKey: string | null;
  position: number | null;
};

/** The minimum supply needed for the homepage rail to read as intentional. */
export const MIN_HOME_CURATED_PRODUCTS = 6;

/** Cross-brand public projection used by the homepage's internal product links. */
export type HomepageCuratedProduct = CuratedProduct & {
  brandSlug: string;
  brandName: string;
  brand: BrandVisitLinkFields & { slug: string };
  /**
   * Intrinsic size of the STORED image object, used by the wall to render each
   * tile at its native ratio (DEV-1479). NULL until the backfill reaches the
   * row; the composer falls back to 4:3 rather than guessing.
   */
  imageWidth: number | null;
  imageHeight: number | null;
};

/** A published product placement as rendered inside one trail section. */
export type TrailCuratedProduct = CuratedProduct & {
  brandSlug: string;
  brandName: string;
  brand: BrandVisitLinkFields & { slug: string };
};

/**
 * `curated_product_sources!inner(id, state)` is the evidence gate: a product with no
 * provenance row is dropped by the join itself, so no TypeScript filter can
 * forget it. Selections embed non-inner — placement is presentation, not proof.
 *
 * Both embeds are narrowed to `state = 'active'` by the query below. The planner
 * retires rather than deletes, so a row's presence is not evidence that it is
 * still live: a product whose every source was withdrawn would otherwise keep
 * passing the proof gate, and a withdrawn selection would keep supplying the
 * sort position.
 *
 * A selection carries no copy of its own any more (DEV-1496) — it is a
 * placement and nothing else, so the columns below are the whole of it.
 */
const CURATED_PRODUCT_READ_SELECT = `
  id, brand_id, key, name_zh, name_en, category, subcategories,
  official_url, image_url,
  image_source_url, visible, link_state, link_checked_at,
  source_checked_at, review_due_at, product_description_zh,
  product_description_en, product_position, created_at,
  curated_product_sources!inner(id),
  curated_product_selections(trail_slug, section_key, position)
`;

type ProductTable = Database["public"]["Tables"]["curated_products"];
type SelectionTable =
  Database["public"]["Tables"]["curated_product_selections"];

type CuratedProductSelectionRow = Pick<
  SelectionTable["Row"],
  "trail_slug" | "section_key" | "position"
> & { state?: string };

type CuratedProductReadRow = Pick<
  ProductTable["Row"],
  | "id"
  | "brand_id"
  | "key"
  | "name_zh"
  | "name_en"
  | "category"
  | "subcategories"
  | "official_url"
  | "image_url"
  | "image_source_url"
  | "visible"
  | "link_state"
  | "link_checked_at"
  | "source_checked_at"
  | "review_due_at"
  | "product_description_zh"
  | "product_description_en"
  | "product_position"
  | "created_at"
> & {
  curated_product_selections: CuratedProductSelectionRow[] | null;
};

type HomepageCuratedProductRow = CuratedProductReadRow & {
  brands: {
    slug: string;
    name: string;
    status?: string;
    purchase_website: string | null;
    purchase_pinkoi: string | null;
    purchase_shopee: string | null;
    purchase_myship: string | null;
    social_instagram: string | null;
    social_threads: string | null;
    social_facebook: string | null;
  } | null;
  curated_product_sources?: { id: string; state?: string }[] | null;
  /**
   * Added by `20260816120000_curated_products_image_dimensions.sql`. Declared
   * here rather than picked from `Database["public"]["Tables"]` because the
   * generated types predate the migration; drop this once `pnpm db:types` has
   * been regenerated against the applied schema.
   */
  image_width?: number | null;
  image_height?: number | null;
};

type TrailCuratedProductRow = CuratedProductReadRow & {
  brands: {
    slug: string;
    name: string;
    status?: string;
    purchase_website: string | null;
    purchase_pinkoi: string | null;
    purchase_shopee: string | null;
    purchase_myship: string | null;
    social_instagram: string | null;
    social_threads: string | null;
    social_facebook: string | null;
  } | null;
  curated_product_sources?: { id: string; state?: string }[] | null;
};

/** Keep the fully-generic PostgREST builder from recursively instantiating here. */
type HomepageCuratedProductQuery = PromiseLike<{
  data: unknown[] | null;
  error: unknown;
}> & {
  in(column: string, values: string[]): HomepageCuratedProductQuery;
  not(
    column: string,
    operator: string,
    value: string,
  ): HomepageCuratedProductQuery;
};

function curatedProductClient(
  client?: CuratedProductSupabase,
): CuratedProductSupabase {
  return client ?? (createServiceClient() as unknown as CuratedProductSupabase);
}

/**
 * The one selection a card carries. A product placed in several trails must
 * still render exactly once, so the lowest `position` wins and an equal
 * position is broken by `trail_slug` alphabetically — a deterministic choice,
 * because PostgREST returns embedded rows in no guaranteed order.
 */
function winningSelection(
  selections: CuratedProductSelectionRow[] | null,
): CuratedProductSelectionRow | null {
  if (!selections || selections.length === 0) return null;
  return (
    [...selections]
      .sort(
        (a, b) =>
          a.position - b.position || a.trail_slug.localeCompare(b.trail_slug),
      )
      .at(0) ?? null
  );
}

function toCuratedProduct(row: CuratedProductReadRow): CuratedProduct {
  const selection = winningSelection(row.curated_product_selections);
  return {
    id: row.id,
    brandId: row.brand_id,
    key: row.key,
    nameZh: row.name_zh,
    nameEn: row.name_en ?? null,
    category: row.category,
    subcategories: row.subcategories ?? [],
    officialUrl: row.official_url ?? null,
    imageUrl: row.image_url ?? null,
    imageSourceUrl: row.image_source_url ?? null,
    visible: row.visible,
    linkState: row.link_state,
    linkCheckedAt: row.link_checked_at ?? null,
    sourceCheckedAt: row.source_checked_at ?? null,
    reviewDueAt: row.review_due_at ?? null,
    productDescriptionZh: row.product_description_zh,
    productDescriptionEn: row.product_description_en ?? null,
    productPosition: row.product_position ?? null,
    createdAt: row.created_at,
    trailSlug: selection?.trail_slug ?? null,
    sectionKey: selection?.section_key ?? null,
    position: selection?.position ?? null,
  };
}

/**
 * Maps one active trail placement. A product may appear in several trails, so
 * the placement supplies the section and the position; the copy comes from the
 * PRODUCT row, which is now the only place any curated text lives. Reading a
 * selection-scoped rationale here is what DEV-1496 removed.
 */
function toTrailProduct(
  row: TrailCuratedProductRow,
  selection: CuratedProductSelectionRow,
): TrailCuratedProduct {
  const brand = row.brands;
  if (!brand) throw new Error(`Trail product ${row.id} is missing its brand`);

  return {
    id: row.id,
    brandId: row.brand_id,
    key: row.key,
    nameZh: row.name_zh,
    nameEn: row.name_en ?? null,
    category: row.category,
    subcategories: row.subcategories ?? [],
    officialUrl: row.official_url ?? null,
    imageUrl: row.image_url ?? null,
    imageSourceUrl: row.image_source_url ?? null,
    visible: row.visible,
    linkState: row.link_state,
    linkCheckedAt: row.link_checked_at ?? null,
    sourceCheckedAt: row.source_checked_at ?? null,
    reviewDueAt: row.review_due_at ?? null,
    productDescriptionZh: row.product_description_zh,
    productDescriptionEn: row.product_description_en ?? null,
    productPosition: row.product_position ?? null,
    createdAt: row.created_at,
    trailSlug: selection.trail_slug,
    sectionKey: selection.section_key,
    position: selection.position,
    brandSlug: brand.slug,
    brandName: brand.name,
    brand: {
      slug: brand.slug,
      purchaseWebsite: brand.purchase_website,
      purchasePinkoi: brand.purchase_pinkoi,
      purchaseShopee: brand.purchase_shopee,
      purchaseMyship: brand.purchase_myship,
      socialInstagram: brand.social_instagram,
      socialThreads: brand.social_threads,
      socialFacebook: brand.social_facebook,
    },
  };
}

/** An unpositioned product sorts last rather than jumping ahead of placed ones. */
const UNPLACED = Number.MAX_SAFE_INTEGER;

/** PostgREST's "could not find the table in the schema cache". */
const MISSING_TABLE_CODE = "PGRST205";
/** Observed from the staging REST read before this migration landed. */
const MISSING_COLUMN_CODE = "42703";

/** True when the error says the database schema is older than this code. */
function isSchemaLag(error: unknown): boolean {
  const code = (error as { code?: string }).code;
  return code === MISSING_TABLE_CODE || code === MISSING_COLUMN_CODE;
}

/**
 * A read that ran against a schema older than the code reading it.
 *
 * Railway builds the image BEFORE `deploy.preDeployCommand` applies migrations,
 * so every `next build` prerender sees the previous schema. A caller that turns
 * this read into a whole page zone must not receive `[]`: an empty array is
 * indistinguishable from "nothing is published", so the zone is dropped from
 * the static HTML, the route stays `●`, the build stays green, and nothing
 * reaches Sentry. That is exactly how the homepage shipped with no product wall
 * (DEV-1490). Callers that only garnish a page may still degrade to `[]`.
 */
export class CuratedProductSchemaLagError extends Error {
  constructor(
    readonly scope: string,
    readonly cause: unknown,
  ) {
    const code = (cause as { code?: string }).code ?? "unknown";
    const message = (cause as { message?: string }).message ?? "";
    super(
      `[${scope}] curated-product read hit a schema older than this deploy ` +
        `(${code}${message ? `: ${message}` : ""}). The migration for this ` +
        "column or table has not been applied to the target database yet.",
    );
    this.name = "CuratedProductSchemaLagError";
  }
}

/**
 * Every publicly renderable curated product for one brand.
 *
 * The proof gate is four conditions, all pushed into the query: the product is
 * `visible`, it has an `official_url`, its sources were checked
 * (`source_checked_at`), and at least one ACTIVE `curated_product_sources` row
 * exists. A product that cannot prove itself never reaches TypeScript.
 *
 * Returns `[]` for a brand with nothing curated, and `[]` when the tables are
 * absent from the PostgREST schema cache: deploys ship on push while migrations
 * are applied by hand, so a brand page must degrade to "no curated section"
 * rather than throw inside the brand-detail `Promise.all`. Every other error is
 * rethrown.
 */
export async function getPublishedCuratedProductsForBrand(
  brandId: string,
  client?: CuratedProductSupabase,
): Promise<CuratedProduct[]> {
  const { data, error } = await curatedProductClient(client)
    .from("curated_products")
    .select(CURATED_PRODUCT_READ_SELECT)
    .eq("brand_id", brandId)
    .eq("visible", true)
    .not("official_url", "is", null)
    .not("source_checked_at", "is", null)
    // Retired evidence is not evidence: `!inner` makes this drop the product.
    .eq("curated_product_sources.state", "active")
    // Non-inner, so this narrows the embedded rows only. A product left with no
    // active selection still renders — it sorts last with a null trail slug.
    .eq("curated_product_selections.state", "active");
  if (error) {
    // PGRST205 = table not in PostgREST schema cache (migration pending or
    // schema cache stale), matching saved-brands.ts. 42703 was observed from
    // staging when the existing table lacked the newly renamed columns.
    // Degrading to "no curated section" is right here — this is one section of
    // a page whose subject is the brand — but it is no longer silent.
    if (isSchemaLag(error)) {
      console.error(
        new CuratedProductSchemaLagError("curatedProducts.brand", error)
          .message,
      );
      return [];
    }
    throw error;
  }

  return ((data ?? []) as unknown as CuratedProductReadRow[])
    .map(toCuratedProduct)
    .sort(
      (a, b) =>
        (a.productPosition ?? UNPLACED) - (b.productPosition ?? UNPLACED) ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.key.localeCompare(b.key),
    );
}

/**
 * The bounded, cross-brand projection for the homepage's selected-product
 * rail. It shares the brand-page publication/evidence gates, then narrows to
 * approved, non-test brands and renderable product images.
 *
 * IT DOES NOT REQUIRE A TRAIL PLACEMENT. `product_description_zh` is NOT NULL,
 * so every published product already carries the copy the wall needs; the old
 * "must have a rationale from a selection or a highlight" filter existed only
 * because the copy used to live on the placement (DEV-1496).
 *
 * This read is intentionally not cached: publishing already revalidates the
 * homepage, while an additional cache would create an invalidation path the
 * publish action cannot reach. Post-processing applies deterministic ordering
 * after the database result is flattened through the same selection resolver as
 * the brand page.
 *
 * A schema older than this code throws `CuratedProductSchemaLagError` rather
 * than degrading to `[]` — see the error class for why the homepage cannot
 * treat that window as "nothing published".
 *
 * THE PER-BRAND CAP IS NOT APPLIED HERE. This read has no seed and no clock, so
 * capping to two per brand before the composer sees the rows freezes WHICH two
 * a brand shows: the daily shuffle can then only permute the same pair, and a
 * brand with three or more published products shows the same two forever. The
 * cap lives once, in `@/lib/curated-products/home-wall`, after the shuffle. The
 * ordering below is a deterministic tie-break only — nothing pins a tile to a
 * slot any more, so the wall is a pure shuffle — and `.limit(1_000)` still
 * bounds the read, comfortably above the ~32 tiles the wall renders.
 */
export async function getPublishedCuratedProductsForHomepage(
  client?: CuratedProductSupabase,
): Promise<HomepageCuratedProduct[]> {
  const query = excludeTestBrands(
    curatedProductClient(client)
      .from("curated_products")
      .select(
        `${CURATED_PRODUCT_READ_SELECT}, image_width, image_height, brands!inner(slug, name, status, purchase_website, purchase_pinkoi, purchase_shopee, purchase_myship, social_instagram, social_threads, social_facebook)`,
      )
      .eq("visible", true)
      .not("official_url", "is", null)
      .not("source_checked_at", "is", null)
      // Retired evidence is not evidence: the inner embed drops products with
      // no active source row.
      .eq("curated_product_sources.state", "active")
      .eq("curated_product_selections.state", "active")
      .eq("brands.status", "approved")
      .not("image_url", "is", null)
      .limit(1_000) as unknown as HomepageCuratedProductQuery,
    "brands.name",
  );
  const { data, error } = await query;

  if (error) {
    // Schema lag THROWS here, unlike the brand read. The homepage turns this
    // result into the entire selection zone, and the gate is a count, so `[]`
    // renders exactly like "nothing is published yet" — a whole zone silently
    // missing from a `●` page, cached for `revalidate`, with a green build and
    // no Sentry event. The caller wraps this in `captureReadFailure`, so a
    // throw reports the failure and marks the render degraded instead.
    if (isSchemaLag(error)) {
      throw new CuratedProductSchemaLagError("curatedProducts.homepage", error);
    }
    throw error;
  }

  const candidates = ((data ?? []) as unknown as HomepageCuratedProductRow[])
    .map((row): HomepageCuratedProduct | null => {
      if (
        !row.brands?.slug ||
        !row.brands.name ||
        (row.brands.status !== undefined && row.brands.status !== "approved") ||
        row.brands.name.startsWith(TEST_BRAND_NAME_PREFIX) ||
        !row.visible ||
        !row.official_url ||
        !row.source_checked_at ||
        !row.image_url ||
        (row.curated_product_sources !== undefined &&
          !(row.curated_product_sources ?? []).some(
            (source) => source.state === undefined || source.state === "active",
          ))
      ) {
        return null;
      }

      // Keep the defensive state filter aligned with the embedded query when a
      // test seam or future projection carries selection states explicitly.
      const activeSelections =
        row.curated_product_selections?.filter(
          (selection) =>
            selection.state === undefined || selection.state === "active",
        ) ?? null;
      const product = toCuratedProduct({
        ...row,
        curated_product_selections: activeSelections,
      });
      return {
        ...product,
        // NULL until the backfill reaches the row; the wall falls back to 4:3.
        imageWidth: row.image_width ?? null,
        imageHeight: row.image_height ?? null,
        brandSlug: row.brands.slug,
        brandName: row.brands.name,
        brand: {
          slug: row.brands.slug,
          purchaseWebsite: row.brands.purchase_website ?? null,
          purchasePinkoi: row.brands.purchase_pinkoi ?? null,
          purchaseShopee: row.brands.purchase_shopee ?? null,
          purchaseMyship: row.brands.purchase_myship ?? null,
          socialInstagram: row.brands.social_instagram ?? null,
          socialThreads: row.brands.social_threads ?? null,
          socialFacebook: row.brands.social_facebook ?? null,
        },
      };
    })
    .filter((product): product is HomepageCuratedProduct => product !== null)
    .sort(
      (a, b) =>
        a.brandSlug.localeCompare(b.brandSlug) || a.key.localeCompare(b.key),
    );

  // No per-brand cap here ON PURPOSE: see the header. The composer applies it
  // after the daily shuffle, over the full published set.
  return candidates;
}

const CURATED_PRODUCT_TRAIL_READ_SELECT = `
  id, brand_id, key, name_zh, name_en, category, subcategories,
  official_url, image_url,
  image_source_url, visible, link_state, link_checked_at,
  source_checked_at, review_due_at, product_description_zh,
  product_description_en, product_position, created_at,
  curated_product_sources!inner(id, state),
  curated_product_selections!inner(trail_slug, section_key, position, state),
  brands!inner(slug, name, status, purchase_website, purchase_pinkoi, purchase_shopee, purchase_myship, social_instagram, social_threads, social_facebook)
`;

/**
 * Resolves the public placements for one trail. Unlike the homepage rail this
 * deliberately keeps every product from a brand: a trail can use one brand in
 * several distinct roles. Each active selection becomes one card, and every
 * card renders the product's own `product_description` — a trail no longer
 * carries copy of its own.
 */
export async function getPublishedCuratedProductsForTrail(
  trailSlug: string,
  client?: CuratedProductSupabase,
): Promise<TrailCuratedProduct[]> {
  const { data, error } = await curatedProductClient(client)
    .from("curated_products")
    .select(CURATED_PRODUCT_TRAIL_READ_SELECT)
    .eq("visible", true)
    .not("official_url", "is", null)
    .not("source_checked_at", "is", null)
    .eq("curated_product_sources.state", "active")
    .eq("curated_product_selections.state", "active")
    .eq("curated_product_selections.trail_slug", trailSlug)
    .eq("brands.status", "approved");

  if (error) {
    // Schema lag THROWS here, exactly as the homepage read does. A trail page
    // turns this result into its whole product body, so `[]` reads as "nothing
    // is placed yet" — the zone silently vanishes from a cached render with a
    // green build and nothing in Sentry. The caller wraps this in
    // `captureReadFailure`, so a throw marks the render degraded instead.
    if (isSchemaLag(error)) {
      throw new CuratedProductSchemaLagError("curatedProducts.trail", error);
    }
    throw error;
  }

  const trail = await getPublishedTrailBySlug(trailSlug).catch(() => null);
  const sectionOrder = new Map(
    trail?.entry.frontmatter.sections.map((section, index) => [
      section.key,
      index,
    ]) ?? [],
  );

  const products: TrailCuratedProduct[] = [];
  for (const rawRow of (data ?? []) as unknown as TrailCuratedProductRow[]) {
    const row = rawRow;
    if (
      !row.brands?.slug ||
      !row.brands.name ||
      (row.brands.status !== undefined && row.brands.status !== "approved") ||
      !row.visible ||
      !row.official_url ||
      !row.source_checked_at
    ) {
      continue;
    }

    const activeSources = row.curated_product_sources ?? [];
    if (
      activeSources.length > 0 &&
      !activeSources.some(
        (source) => source.state === undefined || source.state === "active",
      )
    ) {
      continue;
    }

    const selections = (row.curated_product_selections ?? []).filter(
      (selection) =>
        selection.trail_slug === trailSlug &&
        (selection.state === undefined || selection.state === "active"),
    );

    for (const selection of selections) {
      products.push(toTrailProduct(row, selection));
    }
  }

  return products.sort(
    (a, b) =>
      (sectionOrder.get(a.sectionKey ?? "") ?? UNPLACED) -
        (sectionOrder.get(b.sectionKey ?? "") ?? UNPLACED) ||
      (a.position ?? UNPLACED) - (b.position ?? UNPLACED) ||
      a.key.localeCompare(b.key),
  );
}

// ---------------------------------------------------------------------------
// Write path (DEV-1465)
//
// Two rules hold across every writer below.
//
//   1. They THROW. The read swallows PGRST205 so a brand page degrades to "no
//      curated section" during the window between a deploy and a hand-applied
//      migration; a writer that swallowed it would report success while writing
//      nothing, which is the worse failure by far.
//   2. They never DELETE. Retirement flips `visible` on a product and `state`
//      on a source, so a key is never silently reused and withdrawn evidence
//      stays auditable. The only delete these rows ever see is the FK cascade
//      from `brands`.
// ---------------------------------------------------------------------------

/** Postgres unique_violation — here, always `(brand_id, key)`. */
const UNIQUE_VIOLATION_CODE = "23505";

/** A key collision is resolved by suffixing; the cap only bounds a pathological loop. */
const MAX_KEY_ATTEMPTS = 25;

/** Used when a name transliterates to nothing at all (punctuation, emoji). */
const FALLBACK_KEY = "product";

export type CuratedProductWriteInput = {
  brandId: string;
  /**
   * The key to store, when the caller already HAS one. Absent means "derive it
   * from the name", which is what every interactive create does.
   *
   * The approval materializer supplies it (DEV-1469) because rejection memory
   * hangs off this column: a proposal carries a key derived from the MODEL's
   * name, a reviewer may rename the product before approving, and re-deriving
   * here would store a key the next run's proposal can never match. The diff
   * would then miss on the key axis, re-offer a product a human already
   * declined, and insert it again under a `…-2` suffix.
   */
  key?: string;
  nameZh: string;
  nameEn?: string | null;
  /** CHECK-constrained to the same 12 values as `brands.category`. */
  category: string;
  /** Subcategory slugs or labels; normalized to slugs within `category`. */
  subcategories?: string[];
  /**
   * Material slugs from the closed `MATERIALS` vocabulary. CHECK-constrained in
   * Postgres, so unratified terms are dropped rather than forwarded; absent
   * means `[]`, because the column is `not null default '{}'`.
   */
  material?: string[];
  officialUrl?: string | null;
  imageUrl?: string | null;
  imageSourceUrl?: string | null;
  /**
   * Intrinsic size of the STORED object, written by the image path only
   * (DEV-1479). Left absent on an edit that did not replace the image, so an
   * unrelated save never nulls a measured size.
   */
  imageWidth?: number | null;
  imageHeight?: number | null;
  /** Public visibility. A create defaults to `false`; publishing is a later act. */
  visible?: boolean;
  sourceCheckedAt?: string | null;
  reviewDueAt?: string | null;
  /**
   * The single editorial text field, and the only one. REQUIRED, because the
   * column is NOT NULL: a create that could omit it would fail at the database
   * with a 23502 the editor cannot read. `CuratedProductUpdateInput` is a
   * `Partial` of this, so a patch may still leave it untouched.
   */
  productDescriptionZh: string;
  productDescriptionEn?: string | null;
  productPosition?: number | null;
  /**
   * Origin of the candidate, CHECK-constrained to the three values in
   * `20260814140000_curated_products_proposed_by.sql`. Defaults to `admin`
   * because hand entry is still the only interactive create path; the approval
   * materializer passes `generated` so the review queue can sort a machine
   * proposal apart from a curator's own row (DEV-1469).
   */
  proposedBy?: "admin" | "generated" | "owner";
};

/**
 * Everything a curator may change after creation. `link_state` and
 * `link_checked_at` are absent on purpose: link health is written only by the
 * link checker. A generic patch that accepted them would let an edit form
 * silently overwrite a probe result with stale form state.
 *
 * `material` is omitted for the same class of reason, one step earlier:
 * `updateCuratedProduct` has no branch for it yet, so inheriting the key from
 * `CuratedProductWriteInput` would accept a material patch and drop it without
 * an error. Removing it here makes that a compile error until the edit path
 * exists.
 *
 * `proposedBy` is omitted on the same grounds AND on principle: origin is a
 * fact about how the row came to exist, so an edit must never be able to
 * relabel a generated proposal as hand-entered.
 *
 * `key` is omitted for BOTH reasons at once: `updateCuratedProduct` has no
 * branch for it, so inheriting it would accept a key patch and drop it in
 * silence — and a key is identity. `diffCuratedProductProposals` matches
 * rejection memory on it, and public URLs are built from it, so re-keying a
 * live row is a migration, never an edit.
 */
export type CuratedProductUpdateInput = Partial<
  Omit<CuratedProductWriteInput, "brandId" | "key" | "material" | "proposedBy">
>;

/**
 * Curated-product subcategories, normalized to slugs and confined to the
 * product's own L1.
 *
 * `normalizeSubcategories` resolves slugs and zh-TW labels alike through the
 * closed vocabulary, dedupes by slug and applies the 5-tag cap.
 * `resolveSubcategorySlugs` then drops anything outside `category` — the
 * write-time conjunct that curated products keep on purpose while the
 * directory read paths dropped theirs (DEV-1510).
 */
function normalizeCuratedSubcategories(
  category: string,
  values: readonly string[],
): string[] {
  const { subcategories } = normalizeSubcategories([...values]);
  return resolveSubcategorySlugs(category, subcategories).map(
    (sub) => sub.slug,
  );
}

/**
 * Materials arrive as slugs of the closed `MATERIALS` vocabulary. Anything that
 * does not resolve is DROPPED rather than thrown, matching
 * `normalizeCuratedSubcategories`: both columns are slug columns whose values
 * render as filters, and a term the ontology cannot resolve would render as a
 * dead one.
 *
 * Dropping is also what keeps a partly-bad list writable. `material` carries a
 * CHECK over the twelve ratified slugs, so one unknown term forwarded to
 * Postgres 23514s the whole insert and loses the valid terms with it.
 */
function normalizeCuratedMaterials(values: readonly string[]): string[] {
  const slugs: string[] = [];
  for (const value of values) {
    const material = materialBySlug(value.trim().toLowerCase());
    if (!material) continue;
    if (slugs.includes(material.slug)) continue;
    slugs.push(material.slug);
  }
  return slugs;
}

/**
 * `generateSlug` transliterates Han through pinyin → Wade-Giles, so a
 * Chinese-only name still yields a readable key. `slugifyRomanizedName` must
 * NOT be used here: its `[^a-z0-9]+` strip returns "" for CJK.
 *
 * A caller-supplied `key` wins, and is still passed through `generateSlug`: the
 * column is a slug, and a hand-edited proposal must not be able to store
 * something that is not one. Everything else falls through to the name-derived
 * key, so no existing caller changes behaviour.
 */
function curatedProductKey(input: CuratedProductWriteInput): string {
  return (
    generateSlug(input.key ?? "") ||
    generateSlug(input.nameZh) ||
    generateSlug(input.nameEn ?? "") ||
    FALLBACK_KEY
  );
}

/**
 * The zh columns this table publishes. `name_zh` is NOT NULL and
 * `product_description_zh` is NOT NULL (DEV-1496) — but on the sparse update
 * path a key that the caller did not supply must stay absent, so the guard
 * reads the payload rather than the input.
 */
const GUARDED_ZH_COLUMNS = ["name_zh", "product_description_zh"] as const;

/**
 * Last stop before the Supabase client: REPORT mainland-Chinese vocabulary in
 * the zh columns on the enclosing audit span, and store the text exactly as the
 * author or model wrote it.
 *
 * Report-only, and permanently so (DEV-1546). The rewriting version corrupted
 * correct Taiwan-Mandarin — with no word delimiters, a banned term cannot be
 * told apart from a substring of a correct word, a street name, or a proper
 * noun. The backfill script stays the only mutator, gated on a human diff.
 *
 * Reads the PAYLOAD, and only keys already present, so `updateCuratedProduct`'s
 * sparseness is preserved and a column the caller never mentioned is never
 * introduced. Nothing is written back: the payload is not modified at all.
 *
 * Pure string work — no model call, no extra query, no curation job.
 */
function reportZhVocabulary(
  payload: Record<string, unknown>,
  ctx: AuditCallContext,
): void {
  reportBannedTerms(
    ctx,
    GUARDED_ZH_COLUMNS.filter((column) => column in payload).map(
      (column) => [column, payload[column]] as const,
    ),
  );
}

/**
 * Creates a product. `visible` defaults to `false` — publication is a separate,
 * deliberate act, so no create path silently puts a new row on the site.
 * `proposed_by` records the origin: hand entry by default, `generated` from the
 * approval materializer (DEV-1469), owner submissions later — which is what
 * lets a review queue sort by trust.
 *
 * A `(brand_id, key)` collision is resolved by suffixing rather than thrown:
 * two products from one brand sharing a name is ordinary, and the insert is
 * retried rather than pre-checked so two concurrent creates cannot both read a
 * free key and race.
 */
export async function createCuratedProduct(
  input: CuratedProductWriteInput,
  client?: CuratedProductSupabase,
): Promise<{ id: string; key: string }> {
  return auditedCall(
    {
      provider: "curatedProducts",
      operation: "createCuratedProduct",
      kind: "service",
    },
    async (ctx) => {
      const supabase = curatedProductClient(client);
      const row = {
        brand_id: input.brandId,
        name_zh: input.nameZh,
        name_en: input.nameEn ?? null,
        category: input.category,
        subcategories: normalizeCuratedSubcategories(
          input.category,
          input.subcategories ?? [],
        ),
        material: normalizeCuratedMaterials(input.material ?? []),
        official_url: input.officialUrl ?? null,
        image_url: input.imageUrl ?? null,
        image_source_url: input.imageSourceUrl ?? null,
        image_width: input.imageWidth ?? null,
        image_height: input.imageHeight ?? null,
        source_checked_at: input.sourceCheckedAt ?? null,
        review_due_at: input.reviewDueAt ?? null,
        product_description_zh: input.productDescriptionZh,
        product_description_en: input.productDescriptionEn ?? null,
        product_position: input.productPosition ?? null,
        visible: input.visible ?? false,
        proposed_by: input.proposedBy ?? "admin",
      };

      reportZhVocabulary(row, ctx);

      // Rejection memory (DEV-1469): a caller-supplied `key` wins inside
      // `curatedProductKey`, and the approval materializer always supplies the
      // PROPOSAL's key, so a create can never lose its match.
      const baseKey = curatedProductKey(input);

      for (let attempt = 0; attempt < MAX_KEY_ATTEMPTS; attempt += 1) {
        const key =
          attempt === 0 ? baseKey : withSlugSuffix(baseKey, attempt + 1);
        const { data, error } = await supabase
          .from("curated_products")
          .insert({ ...row, key })
          .select("id, key")
          .single();

        if (!error) {
          const created = data as { id: string; key: string };
          return { id: created.id, key: created.key };
        }
        if ((error as { code?: string }).code !== UNIQUE_VIOLATION_CODE) {
          throw error;
        }
      }

      throw new Error(
        `Could not find a free curated product key for "${baseKey}" on brand ${input.brandId}`,
      );
    },
    { subjectId: input.brandId },
  );
}

/**
 * Edits the editorial fields of one product. The payload carries only the keys
 * the caller supplied, so an untouched column is never rewritten with a stale
 * value — and `link_state` / `link_checked_at` are unreachable by construction
 * (see `CuratedProductUpdateInput`).
 */
export async function updateCuratedProduct(
  id: string,
  input: CuratedProductUpdateInput,
  client?: CuratedProductSupabase,
): Promise<void> {
  return auditedCall(
    {
      provider: "curatedProducts",
      operation: "updateCuratedProduct",
      kind: "service",
    },
    async (ctx) => {
      const payload: Record<string, unknown> = {};
      if (input.nameZh !== undefined) payload.name_zh = input.nameZh;
      if (input.nameEn !== undefined) payload.name_en = input.nameEn ?? null;
      if (input.category !== undefined) payload.category = input.category;
      if (input.subcategories !== undefined) {
        // A subcategory is only meaningful within a category. Defaulting the branch
        // to "" would normalize every subcategory away and write an empty array, so
        // the caller is made to state it instead of losing the tags silently.
        //
        // DEFENSIVE BACKSTOP ONLY. The admin boundary rejects this pair in
        // `curatedProductUpdateSchema.superRefine`, so a raw throw here would
        // otherwise reach the UI as an internal message; it survives for
        // non-action callers (scripts, future writers) that skip the schema.
        if (input.category === undefined) {
          throw new Error(
            "Updating subcategories requires category in the same patch",
          );
        }
        payload.subcategories = normalizeCuratedSubcategories(
          input.category,
          input.subcategories,
        );
      }
      if (input.officialUrl !== undefined) {
        payload.official_url = input.officialUrl ?? null;
      }
      if (input.imageUrl !== undefined)
        payload.image_url = input.imageUrl ?? null;
      if (input.imageSourceUrl !== undefined) {
        payload.image_source_url = input.imageSourceUrl ?? null;
      }
      // Absent keys stay absent: an edit that did not replace the image must
      // not null the measured size the wall renders from.
      if (input.imageWidth !== undefined) {
        payload.image_width = input.imageWidth ?? null;
      }
      if (input.imageHeight !== undefined) {
        payload.image_height = input.imageHeight ?? null;
      }
      if (input.visible !== undefined) payload.visible = input.visible;
      if (input.sourceCheckedAt !== undefined) {
        payload.source_checked_at = input.sourceCheckedAt ?? null;
      }
      if (input.reviewDueAt !== undefined) {
        payload.review_due_at = input.reviewDueAt ?? null;
      }
      // NOT NULL: an explicit null here is a 23502, so the key is only carried
      // when the caller supplied real text. Clearing the description is not an
      // operation the column allows.
      if (input.productDescriptionZh !== undefined) {
        payload.product_description_zh = input.productDescriptionZh;
      }
      if (input.productDescriptionEn !== undefined) {
        payload.product_description_en = input.productDescriptionEn ?? null;
      }
      if (input.productPosition !== undefined) {
        payload.product_position = input.productPosition ?? null;
      }
      if (Object.keys(payload).length === 0) return;

      reportZhVocabulary(payload, ctx);

      const { error } = await curatedProductClient(client)
        .from("curated_products")
        .update(payload)
        .eq("id", id);
      if (error) throw error;
    },
    { subjectId: id },
  );
}

/**
 * Withdraws a product from the site. Sources are left untouched: the evidence
 * behind a claim stays readable after the claim is pulled, and a product
 * un-retired later must not come back stripped of its provenance.
 */
export async function retireCuratedProduct(
  id: string,
  client?: CuratedProductSupabase,
): Promise<void> {
  return auditedCall(
    {
      provider: "curatedProducts",
      operation: "retireCuratedProduct",
      kind: "service",
    },
    async () => {
      const { error } = await curatedProductClient(client)
        .from("curated_products")
        .update({ visible: false })
        .eq("id", id);
      if (error) throw error;
    },
    { subjectId: id },
  );
}

/**
 * Adds or refreshes one piece of provenance.
 *
 * Upserts on `(product_id, url)` — the conflict target the migration exists to
 * provide — so re-saving an editor form that still lists a URL converges rather
 * than duplicating. `state` is written back to 'active' on conflict on purpose:
 * re-adding a URL an editor previously withdrew is a deliberate reinstatement,
 * and leaving the row retired would silently drop it from the evidence gate.
 */
export async function upsertCuratedProductSource(
  productId: string,
  input: { url: string; sourceType: string; claimZh?: string | null },
  client?: CuratedProductSupabase,
): Promise<void> {
  return auditedCall(
    {
      provider: "curatedProducts",
      operation: "upsertCuratedProductSource",
      kind: "service",
    },
    async () => {
      const { error } = await curatedProductClient(client)
        .from("curated_product_sources")
        .upsert(
          {
            product_id: productId,
            url: input.url,
            source_type: input.sourceType,
            claim_zh: input.claimZh ?? null,
            state: "active",
          },
          { onConflict: "product_id,url" },
        );
      if (error) throw error;
    },
    { subjectId: productId },
  );
}

/**
 * Withdraws one piece of provenance. The row survives so the withdrawal itself
 * is auditable; the read query's `state = 'active'` narrowing is what stops it
 * from propping up the evidence gate.
 */
export async function retireCuratedProductSource(
  sourceId: string,
  client?: CuratedProductSupabase,
): Promise<void> {
  return auditedCall(
    {
      provider: "curatedProducts",
      operation: "retireCuratedProductSource",
      kind: "service",
    },
    async () => {
      const { error } = await curatedProductClient(client)
        .from("curated_product_sources")
        .update({ state: "retired" })
        .eq("id", sourceId);
      if (error) throw error;
    },
    { subjectId: sourceId },
  );
}

/**
 * A placement is WHERE a product sits, and nothing else (DEV-1496). It carries
 * no copy: the card renders the product's own `product_description`.
 */
export type CuratedProductSelectionInput = {
  productId: string;
  trailSlug: string;
  sectionKey: string;
  position?: number;
};

export type CuratedProductSelectionKey = Pick<
  CuratedProductSelectionInput,
  "productId" | "trailSlug" | "sectionKey"
>;

type CuratedProductSelectionConflict = {
  product_id: string;
  curated_products: { brand_id: string; key: string } | null;
};

async function validateSelectionInput(
  input: CuratedProductSelectionInput,
): Promise<{
  trailSlug: string;
  sectionKey: string;
  position: number;
}> {
  const trailSlug = input.trailSlug.trim();
  const sectionKey = input.sectionKey.trim();
  const position = input.position ?? 0;
  if (!trailSlug || !sectionKey) {
    throw new Error("Trail and section are required for a product placement");
  }
  if (!Number.isInteger(position) || position < 0) {
    throw new Error("Trail placement position must be a non-negative integer");
  }

  const trail = await getTrailBySlug(trailSlug);
  if (!trail) throw new Error(`Unknown discovery trail: ${trailSlug}`);
  if (
    !trail.entry.frontmatter.sections.some(
      (section) => section.key === sectionKey,
    )
  ) {
    throw new Error(
      `Unknown section "${sectionKey}" for discovery trail "${trailSlug}"`,
    );
  }

  return { trailSlug, sectionKey, position };
}

/** Places or updates a product on the composite selection primary key. */
export async function upsertCuratedProductSelection(
  input: CuratedProductSelectionInput,
  client?: CuratedProductSupabase,
): Promise<void> {
  return auditedCall(
    {
      provider: "curatedProducts",
      operation: "upsertCuratedProductSelection",
      kind: "service",
    },
    async () => {
      const validated = await validateSelectionInput(input);
      const supabase = curatedProductClient(client);
      const { data: productRow, error: productError } = await supabase
        .from("curated_products")
        .select("brand_id")
        .eq("id", input.productId)
        .single();
      if (productError) throw productError;

      const brandId = (productRow as { brand_id?: string } | null)?.brand_id;
      if (!brandId)
        throw new Error(`Curated product not found: ${input.productId}`);

      const { data: conflicts, error: conflictError } = await supabase
        .from("curated_product_selections")
        .select("product_id, curated_products!inner(brand_id, key)")
        .eq("trail_slug", validated.trailSlug)
        .eq("section_key", validated.sectionKey)
        .eq("state", "active")
        .neq("product_id", input.productId)
        .eq("curated_products.brand_id", brandId);
      if (conflictError) throw conflictError;

      const conflict = (
        (conflicts as unknown as CuratedProductSelectionConflict[] | null) ?? []
      ).at(0);
      if (conflict) {
        const conflictingKey =
          conflict.curated_products?.key ?? conflict.product_id;
        throw new Error(
          `sectionKey: section "${validated.sectionKey}" already contains product "${conflictingKey}" from this brand`,
        );
      }

      const { error } = await supabase
        .from("curated_product_selections")
        .upsert(
          {
            product_id: input.productId,
            trail_slug: validated.trailSlug,
            section_key: validated.sectionKey,
            position: validated.position,
            state: "active",
          },
          { onConflict: "product_id,trail_slug,section_key" },
        );
      if (error) throw error;
    },
    { subjectId: input.productId },
  );
}

/** Retires a placement in place so its history remains auditable. */
export async function retireCuratedProductSelection(
  input: CuratedProductSelectionKey,
  client?: CuratedProductSupabase,
): Promise<void> {
  return auditedCall(
    {
      provider: "curatedProducts",
      operation: "retireCuratedProductSelection",
      kind: "service",
    },
    async () => {
      const trailSlug = input.trailSlug.trim();
      const sectionKey = input.sectionKey.trim();
      if (!trailSlug || !sectionKey) {
        throw new Error(
          "Trail and section are required for a product placement",
        );
      }
      const { data, error } = await curatedProductClient(client)
        .from("curated_product_selections")
        .update({ state: "retired" })
        .eq("product_id", input.productId)
        .eq("trail_slug", trailSlug)
        .eq("section_key", sectionKey)
        .select("product_id");
      if (error) throw error;
      if (!Array.isArray(data) || data.length === 0) {
        throw new Error(
          `Curated product selection not found: ${input.productId}/${trailSlug}/${sectionKey}`,
        );
      }
    },
    { subjectId: input.productId },
  );
}

// ---------------------------------------------------------------------------
// Admin read (DEV-1465)
// ---------------------------------------------------------------------------

/**
 * One source row as the admin drawer shows it, including retired ones. Not
 * exported: it is reachable structurally through `AdminCuratedProduct.sources`,
 * and a second exported name for the same shape is what knip reports.
 */
type AdminCuratedProductSource = {
  id: string;
  url: string;
  sourceType: string;
  claimZh: string | null;
  state: string;
  checkedAt: string | null;
};

/**
 * One ACTIVE trail placement as the admin drawer reads it back.
 *
 * The drawer is the only writer of `curated_product_selections`, so a
 * placement that cannot be read back cannot be corrected: before DEV-1487 the
 * form opened blank every time and success was observable only indirectly.
 * Retired rows stay out — they are history, not editable state.
 */
type AdminCuratedProductSelection = {
  trailSlug: string;
  sectionKey: string;
  position: number;
};

/**
 * A curated product as the review queue renders it: visible and hidden alike,
 * the brand it belongs to, ITS SOURCES — the drawer renders those so the editor
 * can see what a product can and cannot prove — and its active trail
 * placements.
 */
export type AdminCuratedProduct = {
  id: string;
  brandId: string;
  brandSlug: string;
  brandName: string;
  key: string;
  nameZh: string;
  nameEn: string | null;
  category: string;
  subcategories: string[];
  officialUrl: string | null;
  imageUrl: string | null;
  imageSourceUrl: string | null;
  visible: boolean;
  linkState: string;
  proposedBy: string;
  sourceCheckedAt: string | null;
  reviewDueAt: string | null;
  productDescriptionZh: string;
  productDescriptionEn: string | null;
  productPosition: number | null;
  updatedAt: string;
  sources: AdminCuratedProductSource[];
  selections: AdminCuratedProductSelection[];
};

/**
 * Ceiling: one unpaged page of the review queue. Raise it to a `.range()` loop
 * (see `fetchAllRows` in scripts/curated-products/shared.ts) when the curated
 * catalog approaches this — the queue is client-filtered, so a truncated read
 * would hide rows with no visible symptom.
 */
const ADMIN_CURATED_PRODUCT_LIMIT = 1_000;

type AdminCuratedProductRow = Omit<CuratedProductReadRow, "link_checked_at"> & {
  proposed_by: string | null;
  updated_at: string;
  brands: { slug: string; name: string } | null;
  curated_product_sources:
    | {
        id: string;
        url: string;
        source_type: string;
        claim_zh: string | null;
        state: string;
        checked_at: string | null;
      }[]
    | null;
};

/**
 * Every curated product for the admin queue, newest edit first.
 *
 * Deliberately unfiltered by visibility and NOT `!inner` on sources: the public
 * read drops a product with no active evidence, but the queue exists precisely
 * to show the editor the ones that cannot yet prove themselves. Retired sources
 * come back too, so a withdrawal stays visible where it was made.
 *
 * Returns `[]` on any schema lag — a missing table (PGRST205) or a missing
 * column (42703) — for the same reason the public read does: deploys ship
 * ahead of hand-applied migrations, and an empty admin queue is a better
 * failure than a 500 page on the screen used to repair things.
 */
export async function listCuratedProductsForAdmin(
  client?: CuratedProductSupabase,
): Promise<AdminCuratedProduct[]> {
  const { data, error } = await curatedProductClient(client)
    .from("curated_products")
    .select(
      `id, brand_id, key, name_zh, name_en, category, subcategories,
       official_url, image_url,
       image_source_url, visible, link_state, proposed_by,
       source_checked_at, review_due_at, product_description_zh,
       product_description_en, product_position, updated_at,
       brands(slug, name),
       curated_product_sources(id, url, source_type, claim_zh, state, checked_at),
       curated_product_selections(trail_slug, section_key, position, state)`,
    )
    .order("updated_at", { ascending: false })
    .limit(ADMIN_CURATED_PRODUCT_LIMIT);

  if (error) {
    // Both lag codes, not just the missing table: this branch renames columns,
    // so the deploy->migrate window returns 42703 from a table that is already
    // in the schema cache. Letting that escape 500s the one screen an admin
    // would use to see and fix the damage.
    if (isSchemaLag(error)) return [];
    throw error;
  }

  return ((data ?? []) as unknown as AdminCuratedProductRow[]).map((row) => ({
    id: row.id,
    brandId: row.brand_id,
    brandSlug: row.brands?.slug ?? "",
    brandName: row.brands?.name ?? "",
    key: row.key,
    nameZh: row.name_zh,
    nameEn: row.name_en ?? null,
    category: row.category,
    subcategories: row.subcategories ?? [],
    officialUrl: row.official_url ?? null,
    imageUrl: row.image_url ?? null,
    imageSourceUrl: row.image_source_url ?? null,
    visible: row.visible,
    linkState: row.link_state,
    proposedBy: row.proposed_by ?? "admin",
    sourceCheckedAt: row.source_checked_at ?? null,
    reviewDueAt: row.review_due_at ?? null,
    productDescriptionZh: row.product_description_zh,
    productDescriptionEn: row.product_description_en ?? null,
    productPosition: row.product_position ?? null,
    updatedAt: row.updated_at,
    sources: (row.curated_product_sources ?? []).map((source) => ({
      id: source.id,
      url: source.url,
      sourceType: source.source_type,
      claimZh: source.claim_zh ?? null,
      state: source.state,
      checkedAt: source.checked_at ?? null,
    })),
    selections: (row.curated_product_selections ?? [])
      .filter((selection) => selection.state === "active")
      .map((selection) => ({
        trailSlug: selection.trail_slug,
        sectionKey: selection.section_key,
        position: selection.position ?? 0,
      })),
  }));
}

/**
 * PostgREST caps a URL, and `.in()` renders every id into it. 200 is the value
 * every other batch reader in the service layer uses (`brands.ts`,
 * `submissions.ts`, `curation-jobs.ts`); it is repeated rather than shared for
 * the same reason they repeat it.
 *
 * IT BOUNDS BRANDS, NOT ROWS, and this reader returns one row per PRODUCT. The
 * page size below is what bounds rows.
 */
const CURATED_PRODUCT_IN_FILTER_CHUNK_SIZE = 200;

/**
 * Rows per request, deliberately under `max_rows = 1000` in
 * `supabase/config.toml`. At that ceiling PostgREST truncates the response with
 * NO error, so a chunk of 200 brands carrying more than a thousand products —
 * ordinary, because hidden rejection rows accumulate by design — would return a
 * partial map that reads exactly like "these brands have no history": every
 * proposal diffs as `new`, a previously-rejected product is offered again, and
 * approval re-inserts it under a key-suffixed key. That is the outcome this
 * function's docstring says it throws to prevent, so the read pages instead.
 */
const CURATED_PRODUCT_BATCH_PAGE_SIZE = 500;

/**
 * A hard stop on the paging loop. 200 brands × 500 rows is 100k products, far
 * past anything real — so reaching it means the pages are not advancing (an
 * unstable order, a proxy ignoring `Range`), and looping forever inside an
 * approval is the worse failure. Throwing keeps the function's contract: this
 * read returns complete data or it raises. It never returns a partial map.
 */
const CURATED_PRODUCT_BATCH_MAX_PAGES = 200;

type CuratedProductBatchRow = Pick<
  ProductTable["Row"],
  "id" | "brand_id" | "key" | "official_url" | "visible" | "proposed_by"
> & {
  /** Narrowed to `state = 'active'` by the query; `[]` means no live evidence. */
  curated_product_sources?: { id: string }[] | null;
};

/**
 * Every listed brand's existing curated products, in the minimum shape
 * `diffCuratedProductProposals` needs (DEV-1469).
 *
 * BATCHED because both callers hold a LIST of brands: the submission review
 * queue classifies the proposals riding every pending submission at once, and
 * approval consults the same rows before it creates anything. Reading per brand
 * would issue one round trip per row on screen — this sits next to
 * `getBrandSlugsBatch` in `/admin/submissions` and mirrors its shape.
 *
 * Visible AND hidden rows, deliberately. A hidden row IS how a rejection is
 * recorded, so filtering on `visible` would erase the exact memory the diff
 * exists to consult and every rejected proposal would read as new again.
 *
 * Schema lag is NOT swallowed here, unlike `listCuratedProductsForAdmin`: an
 * empty answer would make the approval path treat known products as new and
 * insert key-suffixed duplicates, which is worse than a loud failure. A SHORT
 * read is the same failure without the error, which is why the query below
 * pages rather than trusting one request.
 *
 * `hasActiveSource` rides along because the approval materializer needs to tell
 * a decision from a half-finished create. See `ExistingCuratedProduct`.
 */
export async function getCuratedProductsByBrandBatch(
  brandIds: string[],
  client?: CuratedProductSupabase,
): Promise<Map<string, ExistingCuratedProduct[]>> {
  const uniqueIds = [...new Set(brandIds.filter(Boolean))];
  const byBrandId = new Map<string, ExistingCuratedProduct[]>();
  if (uniqueIds.length === 0) return byBrandId;

  const supabase = curatedProductClient(client);
  const chunks: string[][] = [];
  for (
    let index = 0;
    index < uniqueIds.length;
    index += CURATED_PRODUCT_IN_FILTER_CHUNK_SIZE
  ) {
    chunks.push(
      uniqueIds.slice(index, index + CURATED_PRODUCT_IN_FILTER_CHUNK_SIZE),
    );
  }

  const pages = await Promise.all(
    chunks.map(async (chunk) => {
      const rows: CuratedProductBatchRow[] = [];
      // Range-paged to the first SHORT page. `.order()` is what makes that
      // sound: without a total order the same row can appear on two pages and
      // another on none, so the loop needs a stable one — `(brand_id, key)` is
      // unique, so it is total.
      for (let page = 0; page < CURATED_PRODUCT_BATCH_MAX_PAGES; page += 1) {
        const from = page * CURATED_PRODUCT_BATCH_PAGE_SIZE;
        const { data, error } = await supabase
          .from("curated_products")
          .select(
            // A PLAIN embed, never `!inner`: the default is a left join, so a
            // product with no active source is still returned. That row is
            // precisely the half-created one the approval materializer has to
            // REPAIR, and an inner join would hide it and make every re-run a
            // no-op. The `.eq` below narrows the EMBEDDED rows only.
            "id, brand_id, key, official_url, visible, proposed_by, curated_product_sources(id)",
          )
          .in("brand_id", chunk)
          .eq("curated_product_sources.state", "active")
          .order("brand_id", { ascending: true })
          .order("key", { ascending: true })
          .range(from, from + CURATED_PRODUCT_BATCH_PAGE_SIZE - 1);
        if (error) throw error;
        const pageRows = (data ?? []) as unknown as CuratedProductBatchRow[];
        rows.push(...pageRows);
        if (pageRows.length < CURATED_PRODUCT_BATCH_PAGE_SIZE) return rows;
      }

      throw new Error(
        `Curated product batch read did not terminate after ${CURATED_PRODUCT_BATCH_MAX_PAGES} pages`,
      );
    }),
  );

  for (const row of pages.flat()) {
    const rows = byBrandId.get(row.brand_id) ?? [];
    rows.push({
      id: row.id,
      key: row.key,
      officialUrl: row.official_url ?? null,
      visible: row.visible,
      hasActiveSource: (row.curated_product_sources ?? []).length > 0,
      proposedBy: row.proposed_by,
    });
    byBrandId.set(row.brand_id, rows);
  }

  return byBrandId;
}

/**
 * Everything a write path must know about a product that it MUST NOT take from
 * the client (DEV-1465).
 *
 * A server action is a POST endpoint. A caller-supplied `brandId` files an
 * upload under another brand's storage prefix — the exact prefix
 * `scripts/remove-brand.ts` and `scripts/brand-storage-maintenance.ts` derive
 * their reference sets from — and a caller-supplied `previousImageUrl` is a
 * delete primitive over any object under `curated-products/**`. Both are facts
 * about the stored row, so both are read from the row.
 *
 * Returns null for an id that does not exist, which the caller reports rather
 * than writing blind.
 */
export type CuratedProductWriteContext = {
  brandId: string;
  brandSlug: string | null;
  imageUrl: string | null;
  imageSourceUrl: string | null;
  visible: boolean;
};

export async function getCuratedProductWriteContext(
  id: string,
  client?: CuratedProductSupabase,
): Promise<CuratedProductWriteContext | null> {
  const { data, error } = await curatedProductClient(client)
    .from("curated_products")
    .select("brand_id, image_url, image_source_url, visible, brands(slug)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const row = data as unknown as {
    brand_id: string;
    image_url: string | null;
    image_source_url: string | null;
    visible: boolean;
    brands: { slug: string } | null;
  };
  return {
    brandId: row.brand_id,
    brandSlug: row.brands?.slug ?? null,
    imageUrl: row.image_url ?? null,
    imageSourceUrl: row.image_source_url ?? null,
    visible: row.visible,
  };
}

/** The brand slug a write must revalidate, read before or after the write. */
export async function getCuratedProductBrandSlug(
  id: string,
  client?: CuratedProductSupabase,
): Promise<string | null> {
  const { data, error } = await curatedProductClient(client)
    .from("curated_products")
    .select("brands(slug)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  const row = data as unknown as { brands: { slug: string } | null } | null;
  return row?.brands?.slug ?? null;
}

/**
 * The trail slugs a product write must revalidate.
 *
 * Publishing or retiring a product changes the SUPPLY of every trail it is
 * actively selected into, and both `/discover` and `/discover/[slug]` are
 * ISR-cached behind a supply gate — without this, publishing the sixth product
 * for a trail leaves its cached 404 serving for up to an hour. A product can
 * sit in more than one trail, so this returns every distinct active slug.
 */
export async function getCuratedProductTrailSlugs(
  id: string,
  client?: CuratedProductSupabase,
): Promise<string[]> {
  const { data, error } = await curatedProductClient(client)
    .from("curated_product_selections")
    .select("trail_slug")
    .eq("product_id", id)
    .eq("state", "active");
  if (error) throw error;
  const rows = (data as unknown as { trail_slug: string }[] | null) ?? [];
  return [...new Set(rows.map((row) => row.trail_slug))];
}

/**
 * The trail slugs a BRAND-level write must revalidate.
 *
 * Hiding or unhiding a brand adds or removes every one of its products from
 * the trails they are selected into, and `revalidatePublicBrands` does not
 * reach `/discover/[slug]` (see `public-brand-cache.ts`) — so without this a
 * trail keeps serving tiles for a hidden brand, or keeps omitting a restored
 * one, for up to the ISR hour.
 *
 * `curated_product_selections` carries no `brand_id`, so the brand is applied
 * through the inner-joined parent row. `state` is selected as well as filtered
 * because a retired selection must never contribute a target even if the
 * filter is ever dropped from the query.
 *
 * THROWS on any read failure, schema lag included, exactly like its sibling
 * `getCuratedProductTrailSlugs` above. Tolerating a missing column is the
 * caller's decision and one layer owns it: `brandTrailSlugsForRevalidation` in
 * `src/app/admin/actions.ts` already wraps this in `.catch(() => [])`, so an
 * admin write that already succeeded still costs a stale cache entry rather
 * than a failed action — while a caller that cannot afford a silent `[]` can
 * still see the failure.
 */
export async function getBrandTrailSlugs(
  brandId: string,
  client?: CuratedProductSupabase,
): Promise<string[]> {
  const { data, error } = await curatedProductClient(client)
    .from("curated_product_selections")
    .select("trail_slug, state, curated_products!inner(brand_id)")
    .eq("curated_products.brand_id", brandId)
    .eq("state", "active");
  if (error) throw error;
  const rows =
    (data as unknown as { trail_slug: string; state: string }[] | null) ?? [];
  return [
    ...new Set(
      rows.filter((row) => row.state === "active").map((row) => row.trail_slug),
    ),
  ];
}
