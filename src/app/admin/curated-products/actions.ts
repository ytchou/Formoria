"use server";

import { revalidatePath } from "next/cache";

import { runWithAuditContext } from "@/lib/audit/context";
import { requireAdminAction } from "@/lib/auth/require-admin";
import { revalidatePublicBrands } from "@/lib/cache/public-brand-cache";
import { logAdminAction } from "@/lib/services/admin-audit";
import { storeCuratedProductImage } from "@/lib/services/curated-product-image";
import { prefillFromUrl } from "@/lib/services/curated-product-ingest";
import {
  createCuratedProduct,
  getCuratedProductBrandSlug,
  promoteCuratedProduct,
  retireCuratedProduct,
  retireCuratedProductSource,
  updateCuratedProduct,
  upsertCuratedProductSource,
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

type ActionResult = { error: string } | undefined;

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

function actionError(error: unknown, fallback: string): { error: string } {
  return {
    error: error instanceof Error && error.message ? error.message : fallback,
  };
}

/**
 * Applies the image, if the payload carries a source URL for one.
 *
 * `image_usage` is never derived from a successful download — consent is a
 * human assertion, so it is only ever written from the field the editor set.
 * `processImage` throws on GIF/SVG/oversize; that message is propagated so the
 * caller can render it against the image field rather than swallow it.
 */
async function applyImage(
  productId: string,
  brandId: string,
  imageSourceUrl: string,
  previousImageUrl: string | null,
): Promise<string> {
  const { url } = await storeCuratedProductImage({
    brandId,
    productId,
    imageSourceUrl,
    previousImageUrl,
  });
  return url;
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

      await saveSources(id, payload.sources);

      if (payload.imageSourceUrl) {
        const imageUrl = await applyImage(
          id,
          payload.brandId,
          payload.imageSourceUrl,
          null,
        );
        await updateCuratedProduct(id, { imageUrl });
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

export async function updateCuratedProductAction(
  productId: string,
  input: unknown,
  context?: {
    brandId?: string;
    previousImageUrl?: string | null;
    published?: boolean;
  },
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
      const patch: CuratedProductUpdateInput = {};
      if (payload.nameZh !== undefined) patch.nameZh = payload.nameZh;
      if (payload.nameEn !== undefined) patch.nameEn = payload.nameEn;
      if (payload.l1 !== undefined) patch.l1 = payload.l1;
      // `updateCuratedProduct` refuses an l2 patch without its l1: an L2 slug is
      // only meaningful inside one L1.
      if (payload.l2 !== undefined) patch.l2 = payload.l2;
      if (payload.officialUrl !== undefined) {
        patch.officialUrl = payload.officialUrl;
      }
      if (payload.imageSourceUrl !== undefined) {
        patch.imageSourceUrl = payload.imageSourceUrl;
      }
      if (payload.imageUsage !== undefined)
        patch.imageUsage = payload.imageUsage;
      if (payload.notesZh !== undefined) patch.notesZh = payload.notesZh;
      if (payload.notesEn !== undefined) patch.notesEn = payload.notesEn;
      if (payload.reviewDueAt !== undefined) {
        patch.reviewDueAt = payload.reviewDueAt;
      }
      if (payload.sourcesChecked !== undefined) {
        patch.sourceCheckedAt = payload.sourcesChecked
          ? new Date().toISOString()
          : null;
      }

      await saveSources(id, payload.sources);

      if (payload.imageSourceUrl && context?.brandId) {
        patch.imageUrl = await applyImage(
          id,
          context.brandId,
          payload.imageSourceUrl,
          context.previousImageUrl ?? null,
        );
      }

      await updateCuratedProduct(id, patch);

      // An edit to an ALREADY-PUBLISHED product changes what /brands/[slug]
      // renders, so its ISR entry has to go with it.
      const brandSlug = context?.published
        ? await getCuratedProductBrandSlug(id)
        : null;
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

      const brandSlug = await getCuratedProductBrandSlug(id);
      if (auth.user.email) {
        await logAdminAction({
          adminUserId: auth.user.id,
          adminEmail: auth.user.email,
          action: "curated_product_promoted",
          targetBrandSlug: brandSlug ?? undefined,
          metadata: { productId: id },
        });
      }
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
      // Read the slug BEFORE the write: retirement does not move the product to
      // another brand, but reading first keeps the revalidation target known
      // even if the read path later narrows to live rows.
      const brandSlug = await getCuratedProductBrandSlug(id);
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
      revalidateCurated(brandSlug);
      return undefined;
    } catch (error) {
      return actionError(error, "Unable to withdraw the source");
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
