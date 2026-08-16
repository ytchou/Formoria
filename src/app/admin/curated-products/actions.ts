"use server";

import { revalidatePath } from "next/cache";

import { runWithAuditContext } from "@/lib/audit/context";
import { requireAdminAction } from "@/lib/auth/require-admin";
import {
  revalidateLocalizedPath,
  revalidatePublicBrands,
} from "@/lib/cache/public-brand-cache";
import { logAdminAction } from "@/lib/services/admin-audit";
import {
  prepareCuratedProductImage,
  storeCuratedProductImage,
  uploadCuratedProductImage,
} from "@/lib/services/curated-product-image";
import { prefillFromUrl } from "@/lib/services/curated-product-ingest";
import {
  createCuratedProduct,
  getCuratedProductBrandSlug,
  getCuratedProductTrailSlugs,
  getCuratedProductWriteContext,
  promoteCuratedProduct,
  retireCuratedProduct,
  retireCuratedProductSelection,
  retireCuratedProductSource,
  updateCuratedProduct,
  upsertCuratedProductSelection,
  upsertCuratedProductSource,
  type CuratedProductSelectionInput,
  type CuratedProductUpdateInput,
  type PromoteBlocker,
} from "@/lib/services/curated-products";
import {
  curatedProductCreateSchema,
  curatedProductIdSchema,
  curatedProductUpdateSchema,
  prefillUrlSchema,
} from "@/lib/validation/curated-product";

/**
 * Server actions for the curated-product admin queue (DEV-1465).
 *
 * AUTH LIVES IN TWO PLACES AND BOTH ARE REQUIRED. `src/app/admin/layout.tsx`
 * redirects non-admins away from every page under /admin, which is what covers
 * `page.tsx`. It does NOT cover these: a server action is a POST endpoint that
 * is reachable without the layout ever rendering. Every action below therefore
 * opens with `requireAdminAction()`; dropping one leaves an unauthenticated
 * write path onto the curated tables.
 *
 * DELIBERATE DEVIATION FROM src/app/admin/brands/actions.ts: no `scanContent`
 * moderation pass. That heuristic exists to catch owner-submitted spam arriving
 * through the public submission flow. This copy is Formoria's own editorial
 * writing, entered by an admin who is already authenticated as one, so running
 * a spam scan over it only produces false positives that block a save — with no
 * threat model on the other side of the trade.
 *
 * SERVICE-LAYER CALLS ONLY: no Supabase client is imported here (project file
 * ownership table). Actions return `{ error } | undefined` — an absent return
 * IS the success signal; no action reports one with a truthy success flag.
 */

type ActionResult =
  | { error: string; fieldErrors?: Record<string, string> }
  | undefined;

/** A promote refusal carries the missing conditions so the UI can name them. */
type PromoteActionResult =
  { error: string; blockers: PromoteBlocker[] } | { error: string } | undefined;

/**
 * Cache invalidation for a curated write. Silent when missed: `/brands/[slug]`
 * keeps serving its hour-old ISR shell and nothing anywhere reports an error.
 */
function revalidateCurated(brandSlug: string | null): void {
  if (brandSlug) revalidatePublicBrands([brandSlug]);
  revalidatePath("/admin/curated-products");
}

/**
 * Cache invalidation for a trail placement. `/discover/[slug]` lives under the
 * `[locale]` segment, so a bare unprefixed path invalidates nothing.
 */
function revalidateTrail(trailSlug: string): void {
  revalidateLocalizedPath(`/discover/${encodeURIComponent(trailSlug)}`);
  // The hub's trail list is supply-dependent, so a placement change can add or
  // remove a row there too.
  revalidateLocalizedPath("/discover");
}

/**
 * Trail slugs for a revalidation sweep, never a reason to fail the action: the
 * write has already happened (or is about to), so a failed lookup costs a stale
 * cache entry, not correctness. `getCuratedProductBrandSlug` gets the same
 * tolerance by returning `null` instead of throwing.
 */
async function trailSlugsForRevalidation(productId: string): Promise<string[]> {
  return getCuratedProductTrailSlugs(productId).catch(() => []);
}

function actionError(error: unknown, fallback: string): { error: string } {
  return {
    error: error instanceof Error && error.message ? error.message : fallback,
  };
}

function selectionActionError(error: unknown): ActionResult {
  if (error instanceof Error && error.message.startsWith("sectionKey:")) {
    const message = error.message.replace(/^sectionKey:\s*/, "");
    return { error: message, fieldErrors: { sectionKey: message } };
  }
  return actionError(error, "Unable to place the curated product");
}

async function saveSources(
  productId: string,
  sources: { url: string; sourceType: string; claimZh?: string }[] | undefined,
): Promise<void> {
  for (const source of sources ?? []) {
    await upsertCuratedProductSource(productId, {
      url: source.url,
      sourceType: source.sourceType,
      claimZh: source.claimZh ?? null,
    });
  }
}

export async function createCuratedProductAction(
  input: unknown,
): Promise<ActionResult> {
  return runWithAuditContext({}, async () => {
    const auth = await requireAdminAction();
    if ("error" in auth) return { error: auth.error };

    const parsed = curatedProductCreateSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid curated product" };

    try {
      const payload = parsed.data;

      // ORDERING IS THE ATOMICITY STORY. Every step that can fail on an
      // EXTERNAL cause — SSRF refusal, dead origin, GIF/SVG, oversize,
      // undecodable bytes — runs BEFORE the insert and needs no product id. A
      // rejected image therefore leaves no row at all, instead of a candidate
      // whose editor retry creates a key-suffixed duplicate ("widget",
      // "widget-2") carrying a second copy of the sources.
      const processed = payload.imageSourceUrl
        ? await prepareCuratedProductImage(
            payload.imageSourceUrl,
            payload.brandId,
          )
        : null;

      const { id } = await createCuratedProduct({
        brandId: payload.brandId,
        nameZh: payload.nameZh,
        nameEn: payload.nameEn ?? null,
        l1: payload.l1,
        l2: payload.l2 ?? [],
        officialUrl: payload.officialUrl ?? null,
        imageSourceUrl: payload.imageSourceUrl ?? null,
        imageUsage: payload.imageUsage ?? "none",
        notesZh: payload.notesZh ?? null,
        notesEn: payload.notesEn ?? null,
        reviewDueAt: payload.reviewDueAt ?? null,
        // Stamped from the server clock, and only when the editor asserted the
        // sources were read.
        sourceCheckedAt: payload.sourcesChecked
          ? new Date().toISOString()
          : null,
      });

      try {
        await saveSources(id, payload.sources);

        if (processed && payload.imageSourceUrl) {
          const { url } = await uploadCuratedProductImage({
            brandId: payload.brandId,
            productId: id,
            imageSourceUrl: payload.imageSourceUrl,
            processed,
            previousImageUrl: null,
          });
          await updateCuratedProduct(id, { imageUrl: url });
        }
      } catch (error) {
        // The row exists from here on, so the compensating action is to SAY so
        // rather than to unwind: retiring it would keep `(brand_id, key)`
        // taken and a retry would still suffix, and deleting it is forbidden
        // outright (see the write-path rules in services/curated-products.ts).
        // Naming the created product steers the editor to editing it instead
        // of creating a duplicate.
        revalidatePath("/admin/curated-products");
        const detail =
          error instanceof Error && error.message ? error.message : "";
        return {
          error: `The product was created, but finishing it failed${
            detail ? `: ${detail}` : ""
          }. Open it in the queue and save again rather than creating it twice.`,
        };
      }

      // A new product is a candidate, so no public page renders it yet — only
      // the queue needs invalidating.
      revalidatePath("/admin/curated-products");
      return undefined;
    } catch (error) {
      return actionError(error, "Unable to create the curated product");
    }
  });
}

/**
 * Saves an edit.
 *
 * NO CLIENT-SUPPLIED CONTEXT. A server action is a POST endpoint, so an earlier
 * `context` parameter carrying `brandId`, `previousImageUrl`, and `published`
 * handed the caller three things it must not have: the storage prefix an upload
 * is filed under (which `scripts/remove-brand.ts` and
 * `scripts/brand-storage-maintenance.ts` derive their reference sets from), a
 * delete primitive over any object beneath `curated-products/**`, and the flag
 * that decides whether a public page is revalidated. All three are facts about
 * the stored row, so all three are read from it here.
 */
export async function updateCuratedProductAction(
  productId: string,
  input: unknown,
): Promise<ActionResult> {
  return runWithAuditContext({}, async () => {
    const auth = await requireAdminAction();
    if ("error" in auth) return { error: auth.error };

    const idResult = curatedProductIdSchema.safeParse(productId);
    const parsed = curatedProductUpdateSchema.safeParse(input);
    if (!idResult.success || !parsed.success) {
      return { error: "Invalid curated product" };
    }

    try {
      const id = idResult.data;
      const payload = parsed.data;

      const context = await getCuratedProductWriteContext(id);
      if (!context) return { error: "That curated product no longer exists" };

      // The schema is a strict subset of the service's update input once the
      // two keys this action owns are removed, so the field list lives in
      // `updateCuratedProduct` ONLY — a second copy here drifted every time a
      // column was added. An absent key stays absent (column untouched); a key
      // present as `null` survives the spread and clears the column.
      const { sourcesChecked, sources, ...fields } = payload;
      const patch: CuratedProductUpdateInput = { ...fields };
      if (sourcesChecked !== undefined) {
        // Stamped from the server clock: a form that posted its own would be
        // able to back-date the evidence the promote gate reads.
        patch.sourceCheckedAt = sourcesChecked
          ? new Date().toISOString()
          : null;
      }

      await saveSources(id, sources);

      // The image is re-fetched, re-processed and re-uploaded ONLY when the
      // source URL actually changed. Otherwise every unrelated typo fix cost a
      // remote fetch, a sharp pass, an upload and an audit row — and failed the
      // whole save whenever the origin was down. `!context.imageUrl` keeps the
      // retry path alive: a source URL stored by a create whose upload failed
      // is unchanged but has no object behind it yet.
      const imageNeedsWork =
        Boolean(payload.imageSourceUrl) &&
        (payload.imageSourceUrl !== context.imageSourceUrl ||
          !context.imageUrl);
      if (payload.imageSourceUrl && imageNeedsWork) {
        const { url } = await storeCuratedProductImage({
          brandId: context.brandId,
          productId: id,
          imageSourceUrl: payload.imageSourceUrl,
          previousImageUrl: context.imageUrl,
        });
        patch.imageUrl = url;
      }

      await updateCuratedProduct(id, patch);

      // An edit to an ALREADY-PUBLISHED product changes what /brands/[slug]
      // renders, so its ISR entry has to go with it. Read from the row, never
      // from a caller-supplied flag.
      const brandSlug =
        context.lifecycle === "published" ? context.brandSlug : null;
      revalidateCurated(brandSlug);
      return undefined;
    } catch (error) {
      return actionError(error, "Unable to save the curated product");
    }
  });
}

/**
 * Publishes a product, or reports the conditions it still fails.
 *
 * A refusal is a RETURN VALUE from the service, not a throw, and it is passed
 * through here with its blockers intact: the drawer renders the same four
 * conditions from the same shared predicate, so a refused promote names what is
 * missing instead of surfacing as a surprise error.
 */
export async function promoteCuratedProductAction(
  productId: string,
): Promise<PromoteActionResult> {
  return runWithAuditContext({}, async () => {
    const auth = await requireAdminAction();
    if ("error" in auth) return { error: auth.error };

    const idResult = curatedProductIdSchema.safeParse(productId);
    if (!idResult.success) return { error: "Invalid curated product" };

    try {
      const id = idResult.data;
      const outcome = await promoteCuratedProduct(id);
      if (!outcome.ok) {
        return { error: outcome.error, blockers: outcome.blockers };
      }

      // Publishing changes the SUPPLY of every trail this product sits in, and
      // those pages are ISR-cached behind a supply gate.
      const [brandSlug, trailSlugs] = await Promise.all([
        getCuratedProductBrandSlug(id),
        trailSlugsForRevalidation(id),
      ]);
      if (auth.user.email) {
        await logAdminAction({
          adminUserId: auth.user.id,
          adminEmail: auth.user.email,
          action: "curated_product_promoted",
          targetBrandSlug: brandSlug ?? undefined,
          metadata: { productId: id },
        });
      }
      for (const trailSlug of trailSlugs) revalidateTrail(trailSlug);
      revalidateCurated(brandSlug);
      return undefined;
    } catch (error) {
      return actionError(error, "Unable to publish the curated product");
    }
  });
}

export async function retireCuratedProductAction(
  productId: string,
): Promise<ActionResult> {
  return runWithAuditContext({}, async () => {
    const auth = await requireAdminAction();
    if ("error" in auth) return { error: auth.error };

    const idResult = curatedProductIdSchema.safeParse(productId);
    if (!idResult.success) return { error: "Invalid curated product" };

    try {
      const id = idResult.data;
      // Read the slugs BEFORE the write: retirement does not move the product
      // to another brand, but reading first keeps the revalidation targets
      // known even if the read path later narrows to live rows. That matters
      // more for the trail slugs — retiring is exactly what can stop the
      // selections being visible to a later read.
      const [brandSlug, trailSlugs] = await Promise.all([
        getCuratedProductBrandSlug(id),
        trailSlugsForRevalidation(id),
      ]);
      await retireCuratedProduct(id);

      if (auth.user.email) {
        await logAdminAction({
          adminUserId: auth.user.id,
          adminEmail: auth.user.email,
          action: "curated_product_retired",
          targetBrandSlug: brandSlug ?? undefined,
          metadata: { productId: id },
        });
      }
      for (const trailSlug of trailSlugs) revalidateTrail(trailSlug);
      revalidateCurated(brandSlug);
      return undefined;
    } catch (error) {
      return actionError(error, "Unable to retire the curated product");
    }
  });
}

/**
 * Withdraws one source. This can flip the promote gate (a product with no
 * active source cannot publish), so the queue is revalidated with it.
 */
export async function retireCuratedProductSourceAction(
  sourceId: string,
  productId: string,
): Promise<ActionResult> {
  return runWithAuditContext({}, async () => {
    const auth = await requireAdminAction();
    if ("error" in auth) return { error: auth.error };

    const sourceResult = curatedProductIdSchema.safeParse(sourceId);
    const productResult = curatedProductIdSchema.safeParse(productId);
    if (!sourceResult.success || !productResult.success) {
      return { error: "Invalid curated product source" };
    }

    try {
      await retireCuratedProductSource(sourceResult.data);
      const brandSlug = await getCuratedProductBrandSlug(productResult.data);

      // Audited for the same reason promote and retire are: withdrawing the
      // last active source flips a promote-gate condition, so it is an
      // editorial decision, not a form tidy-up.
      if (auth.user.email) {
        await logAdminAction({
          adminUserId: auth.user.id,
          adminEmail: auth.user.email,
          action: "curated_product_source_retired",
          targetBrandSlug: brandSlug ?? undefined,
          metadata: {
            productId: productResult.data,
            sourceId: sourceResult.data,
          },
        });
      }
      revalidateCurated(brandSlug);
      return undefined;
    } catch (error) {
      return actionError(error, "Unable to withdraw the source");
    }
  });
}

function parseSelectionInput(input: unknown): CuratedProductSelectionInput | null {
  if (!input || typeof input !== "object") return null;
  const value = input as Record<string, unknown>;
  if (
    typeof value.productId !== "string" ||
    typeof value.trailSlug !== "string" ||
    typeof value.sectionKey !== "string" ||
    typeof value.rationaleZh !== "string"
  ) {
    return null;
  }
  return {
    productId: value.productId,
    trailSlug: value.trailSlug,
    sectionKey: value.sectionKey,
    rationaleZh: value.rationaleZh,
    rationaleEn: typeof value.rationaleEn === "string" ? value.rationaleEn : null,
    position: typeof value.position === "number" ? value.position : 0,
  };
}

export async function upsertCuratedProductSelectionAction(
  input: unknown,
): Promise<ActionResult> {
  return runWithAuditContext({}, async () => {
    const auth = await requireAdminAction();
    if ("error" in auth) return { error: auth.error };

    const payload = parseSelectionInput(input);
    if (!payload) return { error: "Invalid trail placement" };

    try {
      await upsertCuratedProductSelection(payload);
      const brandSlug = await getCuratedProductBrandSlug(payload.productId);
      if (auth.user.email) {
        await logAdminAction({
          adminUserId: auth.user.id,
          adminEmail: auth.user.email,
          action: "curated_product_selection_placed",
          targetBrandSlug: brandSlug ?? undefined,
          metadata: {
            productId: payload.productId,
            trailSlug: payload.trailSlug,
            sectionKey: payload.sectionKey,
          },
        });
      }
      revalidateTrail(payload.trailSlug);
      revalidateCurated(brandSlug);
      return undefined;
    } catch (error) {
      return selectionActionError(error);
    }
  });
}

export async function retireCuratedProductSelectionAction(
  input: unknown,
): Promise<ActionResult> {
  return runWithAuditContext({}, async () => {
    const auth = await requireAdminAction();
    if ("error" in auth) return { error: auth.error };
    if (!input || typeof input !== "object") return { error: "Invalid trail placement" };
    const value = input as Record<string, unknown>;
    if (
      typeof value.productId !== "string" ||
      typeof value.trailSlug !== "string" ||
      typeof value.sectionKey !== "string"
    ) {
      return { error: "Invalid trail placement" };
    }

    try {
      await retireCuratedProductSelection({
        productId: value.productId,
        trailSlug: value.trailSlug,
        sectionKey: value.sectionKey,
      });
      const brandSlug = await getCuratedProductBrandSlug(value.productId);
      if (auth.user.email) {
        await logAdminAction({
          adminUserId: auth.user.id,
          adminEmail: auth.user.email,
          action: "curated_product_selection_retired",
          targetBrandSlug: brandSlug ?? undefined,
          metadata: {
            productId: value.productId,
            trailSlug: value.trailSlug,
            sectionKey: value.sectionKey,
          },
        });
      }
      revalidateTrail(value.trailSlug);
      revalidateCurated(brandSlug);
      return undefined;
    } catch (error) {
      return actionError(error, "Unable to retire the trail placement");
    }
  });
}

/**
 * Reads an official product page and returns SUGGESTED form values behind the
 * editor's "Fetch details" button. It writes nothing: every value must be
 * confirmed by the editor before it reaches a row.
 */
export async function prefillCuratedProductAction(url: unknown): Promise<
  | { error: string }
  | {
      prefill: {
        nameZh?: string;
        nameEn?: string;
        description?: string;
        imageUrl?: string;
      };
    }
> {
  return runWithAuditContext({}, async () => {
    const auth = await requireAdminAction();
    if ("error" in auth) return { error: auth.error };

    const parsed = prefillUrlSchema.safeParse(url);
    if (!parsed.success) return { error: "Invalid product URL" };

    try {
      return { prefill: await prefillFromUrl(parsed.data) };
    } catch (error) {
      return actionError(error, "Unable to read that page");
    }
  });
}
