import {
  createCuratedProduct,
  getCuratedProductsByBrandBatch,
  upsertCuratedProductSource,
} from "@/lib/services/curated-products";
import { getSubmissionProductReview } from "@/lib/services/submissions";
import type { CuratedProductProposal } from "@/lib/types/enriched-data";
import { diffCuratedProductProposals } from "./proposal-diff";

/**
 * Turns the reviewed curated-product proposals on one submission into
 * `curated_products` rows (DEV-1469). Called AFTER approval — both from the
 * new-brand path (`approve_submission`, which assembles its own
 * `p_brand_data` and never reads `enriched_data`) and from the refresh path
 * (`apply_brand_refresh`), so neither RPC needed a change for this.
 *
 * WHY BOTH TICKED AND UNTICKED PROPOSALS BECOME ROWS. A row is how a decision
 * is remembered. A ticked proposal materializes visible; an unticked one
 * materializes hidden, and that hidden row is the whole rejection record —
 * `diffCuratedProductProposals` finds it on the next run and classifies the
 * proposal `previously-rejected`, so the brand is never re-proposed a product a
 * human already declined. Dropping the unticked ones instead would make every
 * later run re-propose them forever.
 *
 * NO COMMERCE TRUTH is copied, by construction: the fields written below are
 * the whole of a proposal, and `CuratedProductProposal` carries no price,
 * stock, discount, availability, offer, or variant field to copy.
 */
export type MaterializedCuratedProducts = {
  /** Rows inserted, visible plus hidden. */
  created: number;
  visible: number;
  hidden: number;
  /**
   * Proposals the brand's catalog already answered for (`matched` or
   * `previously-rejected`), plus any proposal too incomplete to insert.
   */
  skipped: number;
};

/**
 * A stored proposal is JSONB, so a key the type declares required can still be
 * missing on a row an older run wrote. Every field below is NOT NULL or
 * CHECK-constrained in Postgres, so an incomplete proposal must be skipped
 * here rather than forwarded into a 23502 the admin cannot read.
 *
 * Sources are part of that gate on purpose. A product with no active source row
 * fails the public read's `!inner` evidence join, so it would be a row nothing
 * can render — and back-filling a citation from `officialUrl` is exactly the
 * invention the enrichment phase's `no_source_url` drop exists to prevent.
 */
function isInsertableProposal(proposal: CuratedProductProposal): boolean {
  return Boolean(
    proposal?.key &&
      proposal.nameZh?.trim() &&
      proposal.category?.trim() &&
      proposal.productDescriptionZh?.trim() &&
      Array.isArray(proposal.sources) &&
      proposal.sources.some((source) => source?.url && source?.sourceType),
  );
}

export async function materializeSubmissionCuratedProducts(
  submissionId: string,
  brandId: string,
): Promise<MaterializedCuratedProducts> {
  const result: MaterializedCuratedProducts = {
    created: 0,
    visible: 0,
    hidden: 0,
    skipped: 0,
  };

  const { products, keptProductKeys } =
    await getSubmissionProductReview(submissionId);
  if (products.length === 0) return result;

  // The brand's own rows, read ONCE. This is also the create gate: a matched or
  // previously-rejected proposal must never reach `createCuratedProduct`, which
  // resolves a `(brand_id, key)` collision by suffixing and would happily
  // insert the same product again as `…-2`.
  const existingProducts =
    (await getCuratedProductsByBrandBatch([brandId])).get(brandId) ?? [];
  const diffs = diffCuratedProductProposals(products, existingProducts);

  // `undefined` means the reviewer never recorded a decision, so the section's
  // own default applies: every NEW proposal is kept, and anything the catalog
  // already knows stays out. `[]` is a real decision — kept nothing — and must
  // not fall back to the default.
  const keptKeys = new Set(
    keptProductKeys ??
      diffs.filter((diff) => diff.state === "new").map((diff) => diff.proposal.key),
  );

  // Sequential, and cheap: the enrichment phase caps a run at five proposals.
  // Concurrency would buy nothing and would put two inserts that derive the
  // same base key into the same retry window.
  for (const { proposal, state } of diffs) {
    if (state !== "new" || !isInsertableProposal(proposal)) {
      result.skipped += 1;
      continue;
    }

    const visible = keptKeys.has(proposal.key);
    // `imageUrl` is deliberately absent: mirroring an image is a network fetch
    // plus a decode, and this runs inside the approval's own timeout budget.
    // `imageSourceUrl` is carried so the mirror stays available — and re-checkable
    // for usage rights — in the curated-products editor.
    const { id } = await createCuratedProduct({
      brandId,
      nameZh: proposal.nameZh,
      nameEn: proposal.nameEn ?? null,
      category: proposal.category,
      subcategories: proposal.subcategories ?? [],
      material: proposal.material ?? [],
      officialUrl: proposal.officialUrl ?? null,
      imageSourceUrl: proposal.imageSourceUrl ?? null,
      productDescriptionZh: proposal.productDescriptionZh,
      visible,
      // Origin, not actor: the review queue has to be able to tell a machine
      // proposal from a curator's own row.
      proposedBy: "generated",
    });

    for (const source of proposal.sources) {
      if (!source?.url || !source?.sourceType) continue;
      await upsertCuratedProductSource(id, {
        url: source.url,
        sourceType: source.sourceType,
        claimZh: source.claimZh ?? null,
      });
    }

    result.created += 1;
    if (visible) result.visible += 1;
    else result.hidden += 1;
  }

  return result;
}
