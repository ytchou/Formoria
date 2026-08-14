import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import type { Database } from "@/lib/supabase/database.types";
import { auditedCall } from "@/lib/audit";
import {
  curatedProductPromoteBlockers,
  type PromoteOutcome,
} from "@/lib/curated-products/promote-gate";
import { withSlugSuffix } from "@/lib/brands/slug";
import { generateSlug } from "@/lib/services/brands";
import { normalizeProductTags } from "@/lib/services/product-tags";
import {
  matchSubcategory,
  normalizeTagKey,
  resolveSubcategorySlugs,
} from "@/lib/taxonomy/ontology";

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

// ---------------------------------------------------------------------------
// Write path (DEV-1465)
//
// Two rules hold across every writer below.
//
//   1. They THROW. The read swallows PGRST205 so a brand page degrades to "no
//      curated section" during the window between a deploy and a hand-applied
//      migration; a writer that swallowed it would report success while writing
//      nothing, which is the worse failure by far.
//   2. They never DELETE. Retirement flips `lifecycle` on a product and `state`
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
  nameZh: string;
  nameEn?: string | null;
  /** CHECK-constrained to the same 12 values as `brands.product_type`. */
  l1: string;
  /** Subcategory slugs or labels; normalized to slugs within `l1`. */
  l2?: string[];
  officialUrl?: string | null;
  imageUrl?: string | null;
  imageSourceUrl?: string | null;
  imageUsage?: string;
  sourceCheckedAt?: string | null;
  reviewDueAt?: string | null;
  notesZh?: string | null;
  notesEn?: string | null;
};

/**
 * Everything a curator may change after creation. `lifecycle`, `link_state`,
 * and `link_checked_at` are absent on purpose: lifecycle moves only through
 * `promoteCuratedProduct` / `retireCuratedProduct`, and link health is written
 * only by the link checker. A generic patch that accepted them would let an
 * edit form silently overwrite a probe result with stale form state.
 */
export type CuratedProductUpdateInput = Partial<
  Omit<CuratedProductWriteInput, "brandId">
>;

/**
 * The gate itself lives in `@/lib/curated-products/promote-gate`, a pure module
 * with no service imports, so the admin drawer's CLIENT-side readout can call
 * the very same function. Importing this module there is impossible — it
 * reaches `@/lib/services/brands`, which is `server-only` — and a second copy
 * of the four conditions is precisely the drift the shared predicate prevents.
 * Re-exported here so server code keeps one import site.
 */
export {
  curatedProductPromoteBlockers,
  type PromoteBlocker,
  type PromoteOutcome,
} from "@/lib/curated-products/promote-gate";

/**
 * L2 arrives as either ontology slugs (from the admin picker) or Chinese labels
 * (from a pasted list), so both are folded into one vocabulary before
 * `normalizeProductTags` applies the shared dedupe, novel-tag, and cap rules.
 * Anything that does not resolve to a subcategory of `l1` is dropped: `l2` is a
 * slug column, and a free-text tag stored there would render as a dead filter.
 */
function normalizeCuratedL2(l1: string, l2: readonly string[]): string[] {
  const seenInput = new Set<string>();
  const raw: string[] = [];
  for (const value of l2) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = normalizeTagKey(trimmed);
    if (seenInput.has(key)) continue;
    seenInput.add(key);
    raw.push(trimmed);
  }
  if (raw.length === 0) return [];

  // Slug inputs that belong to this L1 become their labels, so one vocabulary
  // reaches `normalizeProductTags`.
  const labelBySlug = new Map(
    resolveSubcategorySlugs(l1, raw).map((sub) => [sub.slug, sub.nameZh]),
  );
  const { tags } = normalizeProductTags(
    raw.map((value) => labelBySlug.get(value) ?? value),
    [],
    l1,
  );

  const slugs: string[] = [];
  for (const tag of tags) {
    const sub = matchSubcategory(tag);
    if (!sub || sub.category !== l1) continue;
    if (slugs.includes(sub.slug)) continue;
    slugs.push(sub.slug);
  }
  return slugs;
}

/**
 * `generateSlug` transliterates Han through pinyin → Wade-Giles, so a
 * Chinese-only name still yields a readable key. `slugifyRomanizedName` must
 * NOT be used here: its `[^a-z0-9]+` strip returns "" for CJK.
 */
function curatedProductKey(input: CuratedProductWriteInput): string {
  return (
    generateSlug(input.nameZh) ||
    generateSlug(input.nameEn ?? "") ||
    FALLBACK_KEY
  );
}

/**
 * Creates a candidate. `lifecycle` is written here and never taken from the
 * caller — publication is an act with a gate in front of it
 * (`promoteCuratedProduct`), so no create path may shortcut into `published`.
 * `proposed_by` records the origin: hand entry today, LLM proposals and owner
 * submissions later, which is what lets a review queue sort by trust.
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
    async () => {
      const supabase = curatedProductClient(client);
      const baseKey = curatedProductKey(input);
      const row = {
        brand_id: input.brandId,
        name_zh: input.nameZh,
        name_en: input.nameEn ?? null,
        l1: input.l1,
        l2: normalizeCuratedL2(input.l1, input.l2 ?? []),
        official_url: input.officialUrl ?? null,
        image_url: input.imageUrl ?? null,
        image_source_url: input.imageSourceUrl ?? null,
        image_usage: input.imageUsage ?? "none",
        source_checked_at: input.sourceCheckedAt ?? null,
        review_due_at: input.reviewDueAt ?? null,
        notes_zh: input.notesZh ?? null,
        notes_en: input.notesEn ?? null,
        lifecycle: "candidate",
        proposed_by: "admin",
      };

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
 * value — and `link_state` / `link_checked_at` / `lifecycle` are unreachable by
 * construction (see `CuratedProductUpdateInput`).
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
    async () => {
      const payload: Record<string, unknown> = {};
      if (input.nameZh !== undefined) payload.name_zh = input.nameZh;
      if (input.nameEn !== undefined) payload.name_en = input.nameEn ?? null;
      if (input.l1 !== undefined) payload.l1 = input.l1;
      if (input.l2 !== undefined) {
        // L2 is only meaningful within an L1. Defaulting the branch to "" would
        // normalize every tag away and write an empty array, so the caller is
        // made to state it instead of losing the tags silently.
        if (input.l1 === undefined) {
          throw new Error("Updating l2 requires l1 in the same patch");
        }
        payload.l2 = normalizeCuratedL2(input.l1, input.l2);
      }
      if (input.officialUrl !== undefined) {
        payload.official_url = input.officialUrl ?? null;
      }
      if (input.imageUrl !== undefined) payload.image_url = input.imageUrl ?? null;
      if (input.imageSourceUrl !== undefined) {
        payload.image_source_url = input.imageSourceUrl ?? null;
      }
      if (input.imageUsage !== undefined) payload.image_usage = input.imageUsage;
      if (input.sourceCheckedAt !== undefined) {
        payload.source_checked_at = input.sourceCheckedAt ?? null;
      }
      if (input.reviewDueAt !== undefined) {
        payload.review_due_at = input.reviewDueAt ?? null;
      }
      if (input.notesZh !== undefined) payload.notes_zh = input.notesZh ?? null;
      if (input.notesEn !== undefined) payload.notes_en = input.notesEn ?? null;
      if (Object.keys(payload).length === 0) return;

      const { error } = await curatedProductClient(client)
        .from("curated_products")
        .update(payload)
        .eq("id", id);
      if (error) throw error;
    },
    { subjectId: id },
  );
}

type PromoteGateRow = {
  lifecycle: string;
  official_url: string | null;
  source_checked_at: string | null;
  curated_product_sources: { state: string }[] | null;
};

/**
 * Publishes a product, or refuses with the conditions that are missing.
 *
 * A refusal is a return value, not a throw: an incomplete candidate is the
 * normal state of editorial work, and the caller renders the blockers as the
 * curator's to-do list. Only genuine database failures throw.
 */
export async function promoteCuratedProduct(
  id: string,
  client?: CuratedProductSupabase,
): Promise<PromoteOutcome> {
  return auditedCall(
    {
      provider: "curatedProducts",
      operation: "promoteCuratedProduct",
      kind: "service",
    },
    async (ctx) => {
      const supabase = curatedProductClient(client);
      const { data, error } = await supabase
        .from("curated_products")
        .select(
          "lifecycle, official_url, source_checked_at, curated_product_sources(state)",
        )
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error(`Curated product not found: ${id}`);

      const row = data as unknown as PromoteGateRow;
      const blockers = curatedProductPromoteBlockers(
        {
          lifecycle: row.lifecycle,
          officialUrl: row.official_url,
          sourceCheckedAt: row.source_checked_at,
        },
        row.curated_product_sources ?? [],
      );
      if (blockers.length > 0) {
        // Why a promote was refused is the question the audit trail gets asked.
        ctx.summary.blockers = blockers;
        return {
          ok: false as const,
          blockers,
          error: `Cannot publish curated product ${id}: ${blockers.join(", ")}`,
        };
      }

      const { error: updateError } = await supabase
        .from("curated_products")
        .update({ lifecycle: "published" })
        .eq("id", id);
      if (updateError) throw updateError;

      return { ok: true as const };
    },
    {
      subjectId: id,
      // A refusal is not a failure — nothing broke — but it must not read as a
      // successful publish either. `empty` is the registry's "ran, wrote
      // nothing" status.
      classify: (result) => (result.ok ? "succeeded" : "empty"),
    },
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
        .update({ lifecycle: "retired" })
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

// ---------------------------------------------------------------------------
// Admin read (DEV-1465)
// ---------------------------------------------------------------------------

/** One source row as the admin drawer shows it, including retired ones. */
export type AdminCuratedProductSource = {
  id: string;
  url: string;
  sourceType: string;
  claimZh: string | null;
  state: string;
  checkedAt: string | null;
};

/**
 * A curated product as the review queue renders it: every lifecycle, the brand
 * it belongs to, and ITS SOURCES — the drawer feeds those straight into
 * `curatedProductPromoteBlockers`, so a readout and the writer's gate are
 * computed from the same two inputs.
 */
export type AdminCuratedProduct = {
  id: string;
  brandId: string;
  brandSlug: string;
  brandName: string;
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
  proposedBy: string;
  sourceCheckedAt: string | null;
  reviewDueAt: string | null;
  notesZh: string | null;
  notesEn: string | null;
  updatedAt: string;
  sources: AdminCuratedProductSource[];
};

/**
 * Ceiling: one unpaged page of the review queue. Raise it to a `.range()` loop
 * (see `fetchAllRows` in scripts/curated-products/shared.ts) when the curated
 * catalog approaches this — the queue is client-filtered, so a truncated read
 * would hide rows with no visible symptom.
 */
const ADMIN_CURATED_PRODUCT_LIMIT = 1_000;

type AdminCuratedProductRow = Omit<
  CuratedProductReadRow,
  "curated_product_selections" | "link_checked_at"
> & {
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
 * Deliberately unfiltered by lifecycle and NOT `!inner` on sources: the public
 * read drops a product with no active evidence, but the queue exists precisely
 * to show the editor the ones that cannot yet prove themselves. Retired sources
 * come back too, so a withdrawal stays visible where it was made.
 *
 * Returns `[]` when the tables are missing from the PostgREST schema cache, for
 * the same reason the public read does: deploys ship ahead of hand-applied
 * migrations, and an empty admin queue is a better failure than a 500 page.
 */
export async function listCuratedProductsForAdmin(
  client?: CuratedProductSupabase,
): Promise<AdminCuratedProduct[]> {
  const { data, error } = await curatedProductClient(client)
    .from("curated_products")
    .select(
      `id, brand_id, key, name_zh, name_en, l1, l2, official_url, image_url,
       image_source_url, image_usage, lifecycle, link_state, proposed_by,
       source_checked_at, review_due_at, notes_zh, notes_en, updated_at,
       brands(slug, name),
       curated_product_sources(id, url, source_type, claim_zh, state, checked_at)`,
    )
    .order("updated_at", { ascending: false })
    .limit(ADMIN_CURATED_PRODUCT_LIMIT);

  if (error) {
    if ((error as { code?: string }).code === MISSING_TABLE_CODE) return [];
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
    l1: row.l1,
    l2: row.l2 ?? [],
    officialUrl: row.official_url ?? null,
    imageUrl: row.image_url ?? null,
    imageSourceUrl: row.image_source_url ?? null,
    imageUsage: row.image_usage,
    lifecycle: row.lifecycle,
    linkState: row.link_state,
    proposedBy: row.proposed_by ?? "admin",
    sourceCheckedAt: row.source_checked_at ?? null,
    reviewDueAt: row.review_due_at ?? null,
    notesZh: row.notes_zh ?? null,
    notesEn: row.notes_en ?? null,
    updatedAt: row.updated_at,
    sources: (row.curated_product_sources ?? []).map((source) => ({
      id: source.id,
      url: source.url,
      sourceType: source.source_type,
      claimZh: source.claim_zh ?? null,
      state: source.state,
      checkedAt: source.checked_at ?? null,
    })),
  }));
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
