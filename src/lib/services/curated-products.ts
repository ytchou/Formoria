import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import type { Database } from "@/lib/supabase/database.types";

/** The tables are reached through the untyped `from` surface, with generated DB shapes at the boundary. */
export type CuratedProductSupabase = Pick<SupabaseClient, "from">;

/**
 * One curated product as the brand page renders it: the product itself plus the
 * single selection whose rationale is shown beside it.
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
  l1: string;
  l2: string[];
  officialUrl: string | null;
  imageUrl: string | null;
  imageSourceUrl: string | null;
  imageUsage: string;
  lifecycle: string;
  linkState: string;
  linkCheckedAt: string | null;
  sourceCheckedAt: string | null;
  reviewDueAt: string | null;
  notesZh: string | null;
  notesEn: string | null;
  /** The winning selection: lowest `position`, ties broken by `trailSlug`. */
  trailSlug: string | null;
  sectionKey: string | null;
  position: number | null;
  rationaleZh: string | null;
  rationaleEn: string | null;
};

/**
 * `curated_product_sources!inner(id)` is the evidence gate: a product with no
 * provenance row is dropped by the join itself, so no TypeScript filter can
 * forget it. Selections embed non-inner — placement is presentation, not proof.
 *
 * Both embeds are narrowed to `state = 'active'` by the query below. The planner
 * retires rather than deletes, so a row's presence is not evidence that it is
 * still live: a product whose every source was withdrawn would otherwise keep
 * passing the proof gate, and a withdrawn selection would keep supplying the
 * public rationale and the sort position.
 */
const CURATED_PRODUCT_READ_SELECT = `
  id, brand_id, key, name_zh, name_en, l1, l2, official_url, image_url,
  image_source_url, image_usage, lifecycle, link_state, link_checked_at,
  source_checked_at, review_due_at, notes_zh, notes_en,
  curated_product_sources!inner(id),
  curated_product_selections(trail_slug, section_key, position, rationale_zh, rationale_en)
`;

type ProductTable = Database["public"]["Tables"]["curated_products"];
type SelectionTable =
  Database["public"]["Tables"]["curated_product_selections"];

type CuratedProductSelectionRow = Pick<
  SelectionTable["Row"],
  "trail_slug" | "section_key" | "position" | "rationale_zh" | "rationale_en"
>;

type CuratedProductReadRow = Pick<
  ProductTable["Row"],
  | "id"
  | "brand_id"
  | "key"
  | "name_zh"
  | "name_en"
  | "l1"
  | "l2"
  | "official_url"
  | "image_url"
  | "image_source_url"
  | "image_usage"
  | "lifecycle"
  | "link_state"
  | "link_checked_at"
  | "source_checked_at"
  | "review_due_at"
  | "notes_zh"
  | "notes_en"
> & {
  curated_product_selections: CuratedProductSelectionRow[] | null;
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
  return [...selections].sort(
    (a, b) =>
      a.position - b.position || a.trail_slug.localeCompare(b.trail_slug),
  )[0]!;
}

function toCuratedProduct(row: CuratedProductReadRow): CuratedProduct {
  const selection = winningSelection(row.curated_product_selections);
  return {
    id: row.id,
    brandId: row.brand_id,
    key: row.key,
    nameZh: row.name_zh,
    nameEn: row.name_en ?? null,
    l1: row.l1,
    l2: row.l2 ?? [],
    officialUrl: row.official_url ?? null,
    imageUrl: row.image_url ?? null,
    imageSourceUrl: row.image_source_url ?? null,
    imageUsage: row.image_usage,
    lifecycle: row.lifecycle,
    linkState: row.link_state,
    linkCheckedAt: row.link_checked_at ?? null,
    sourceCheckedAt: row.source_checked_at ?? null,
    reviewDueAt: row.review_due_at ?? null,
    notesZh: row.notes_zh ?? null,
    notesEn: row.notes_en ?? null,
    trailSlug: selection?.trail_slug ?? null,
    sectionKey: selection?.section_key ?? null,
    position: selection?.position ?? null,
    rationaleZh: selection?.rationale_zh ?? null,
    rationaleEn: selection?.rationale_en ?? null,
  };
}

/** An unplaced product sorts last rather than jumping ahead of placed ones. */
const UNPLACED = Number.MAX_SAFE_INTEGER;

/** PostgREST's "could not find the table in the schema cache". */
const MISSING_TABLE_CODE = "PGRST205";

/**
 * Every publicly renderable curated product for one brand.
 *
 * The proof gate is four conditions, all pushed into the query: the product is
 * `published`, it has an `official_url`, its sources were checked
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
    .eq("lifecycle", "published")
    .not("official_url", "is", null)
    .not("source_checked_at", "is", null)
    // Retired evidence is not evidence: `!inner` makes this drop the product.
    .eq("curated_product_sources.state", "active")
    // Non-inner, so this narrows the embedded rows only. A product left with no
    // active selection still renders — it sorts last with a null rationale.
    .eq("curated_product_selections.state", "active");
  if (error) {
    // PGRST205 = table not in PostgREST schema cache (migration pending or
    // schema cache stale), matching saved-brands.ts.
    if ((error as { code?: string }).code === MISSING_TABLE_CODE) return [];
    throw error;
  }

  return ((data ?? []) as unknown as CuratedProductReadRow[])
    .map(toCuratedProduct)
    .sort(
      (a, b) =>
        (a.position ?? UNPLACED) - (b.position ?? UNPLACED) ||
        a.key.localeCompare(b.key),
    );
}
