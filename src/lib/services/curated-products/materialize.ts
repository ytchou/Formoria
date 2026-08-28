import {
  createCuratedProduct,
  getOriginCandidateUrls,
  getCuratedProductsByBrandBatch,
  refreshGeneratedCuratedProductOrigin,
  upsertCuratedProductSource,
  type CuratedProductSupabase,
} from "@/lib/services/curated-products";
import {
  getSubmissionProductReview,
  type SubmissionProductReview,
} from "@/lib/services/submissions";
import type {
  CuratedProductProposal,
  CuratedProductProposalSource,
} from "@/lib/types/enriched-data";
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
   * Existing rows whose evidence was re-attached because a previous run created
   * the product and then failed on its sources. Not a create: the row, its key
   * and its visibility are untouched.
   */
  repaired: number;
  /**
   * Proposals the brand's catalog already answered for (`matched` or
   * `previously-rejected`), plus any proposal too incomplete to insert.
   */
  skipped: number;
  /**
   * Proposals whose write threw. The loop keeps going — one bad proposal must
   * not cost the other four — and the count is what tells the caller the run
   * was partial.
   */
  failed: number;
};

/**
 * `""` is a legal `officialUrl` on a proposal by design: the review schema
 * admits it so the products section stays saveable while a reviewer is still
 * editing. It is NOT a legal value on the row. NULL is the column's established
 * empty value (every other write path types it `httpUrlSchema.nullable()`),
 * there is no non-empty CHECK to catch it, and `''` would satisfy the public
 * read's `.not("official_url","is",null)` gate with a value that is not a URL.
 */
function normalizedOfficialUrl(
  proposal: CuratedProductProposal,
): string | null {
  const trimmed = proposal.officialUrl?.trim();
  return trimmed ? trimmed : null;
}

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
 *
 * `officialUrl` IS PART OF THAT GATE TOO, decided here rather than left to the
 * nullable column. It is half the four-condition publication proof, so a ticked
 * proposal without one materializes a row that can never render, silently; and
 * materializing an unticked one records a rejection for a proposal the reviewer
 * had not finished editing. The products phase always proposes one (the model
 * schema requires `official_url` and validation drops a proposal without it),
 * so an empty value can only come from a half-finished edit — and skipping is
 * the reversible answer, because the next run offers the proposal again.
 */
function isInsertableProposal(proposal: CuratedProductProposal): boolean {
  return Boolean(
    proposal?.key &&
      proposal.nameZh?.trim() &&
      proposal.category?.trim() &&
      proposal.productDescriptionZh?.trim() &&
      normalizedOfficialUrl(proposal) &&
      insertableSources(proposal).length > 0,
  );
}

/**
 * The citations worth writing, deduped by URL.
 *
 * DEDUPE FIRST, because the upserts below run CONCURRENTLY.
 * `validateProductProposals` does not dedupe, and two in-flight upserts sharing
 * the `(product_id, url)` conflict target would race each other.
 */
function insertableSources(
  proposal: CuratedProductProposal,
): CuratedProductProposalSource[] {
  const byUrl = new Map<string, CuratedProductProposalSource>();
  for (const source of proposal.sources ?? []) {
    if (!source?.url || !source?.sourceType) continue;
    if (byUrl.has(source.url)) continue;
    byUrl.set(source.url, source);
  }
  return [...byUrl.values()];
}

async function writeSources(
  productId: string,
  proposal: CuratedProductProposal,
  client?: CuratedProductSupabase,
): Promise<void> {
  // Parallel: up to five citations per product, each its own round trip plus an
  // `external_call_audit` row, all inside an interactive approval's budget. The
  // sequencing rationale on the product loop below covers `createCuratedProduct`
  // only — these share no key space, so nothing orders them.
  await Promise.all(
    insertableSources(proposal).map((source) =>
      upsertCuratedProductSource(
        productId,
        {
          url: source.url,
          sourceType: source.sourceType,
          claimZh: source.claimZh ?? null,
        },
        client,
      ),
    ),
  );
}

type MaterializeCuratedProductsOptions = {
  /**
   * The effective review layer, when the caller already holds it.
   * `approveSubmission` computes exactly this a moment earlier, so passing it
   * saves a second read of the same row AND removes the chance of the two
   * disagreeing. Absent — the refresh path, which has no such value — falls
   * back to reading it.
   */
  review?: SubmissionProductReview;
  /** Injected in tests; production uses the module's own service client. */
  client?: CuratedProductSupabase;
};

export async function materializeSubmissionCuratedProducts(
  submissionId: string,
  brandId: string,
  options: MaterializeCuratedProductsOptions = {},
): Promise<MaterializedCuratedProducts> {
  const result: MaterializedCuratedProducts = {
    created: 0,
    visible: 0,
    hidden: 0,
    repaired: 0,
    skipped: 0,
    failed: 0,
  };

  const { products, keptProductKeys } =
    options.review ?? (await getSubmissionProductReview(submissionId));
  if (products.length === 0) return result;

  let originCandidateUrls = new Map<string, string>();
  try {
    originCandidateUrls = await getOriginCandidateUrls(
      products.flatMap((proposal) =>
        proposal.originCandidateId ? [proposal.originCandidateId] : [],
      ),
      options.client,
    );
  } catch {
    // Audit linkage is part of qualification. A read failure clears origin but
    // cannot block publication of an otherwise approved product.
  }

  const proposalOrigin = (proposal: CuratedProductProposal) => {
    const auditedUrl = proposal.originCandidateId
      ? originCandidateUrls.get(proposal.originCandidateId)
      : null;
    const urlStillAssessed =
      auditedUrl !== null &&
      auditedUrl !== undefined &&
      auditedUrl.trim() === proposal.officialUrl.trim();
    return urlStillAssessed
      ? {
          madeInTaiwanConfirmed: proposal.madeInTaiwanConfirmed ?? false,
          materialsFromTaiwanConfirmed:
            proposal.materialsFromTaiwanConfirmed ?? false,
          mitRegistryId: proposal.mitRegistryId ?? null,
          originCandidateId: proposal.originCandidateId ?? null,
        }
      : {
          madeInTaiwanConfirmed: false,
          materialsFromTaiwanConfirmed: false,
          mitRegistryId: null,
          originCandidateId: null,
        };
  };

  // The brand's own rows, read ONCE. This is also the create gate: a matched or
  // previously-rejected proposal must never reach `createCuratedProduct`, which
  // resolves a `(brand_id, key)` collision by suffixing and would happily
  // insert the same product again as `…-2`.
  const existingProducts =
    (await getCuratedProductsByBrandBatch([brandId], options.client)).get(
      brandId,
    ) ?? [];
  const diffs = diffCuratedProductProposals(products, existingProducts);

  // `undefined` means the reviewer never recorded a decision, so the section's
  // own default applies: every NEW proposal is kept, and anything the catalog
  // already knows stays out. `[]` is a real decision — kept nothing — and must
  // not fall back to the default.
  const keptKeys = new Set(
    keptProductKeys ??
      diffs.filter((diff) => diff.state === "new").map((diff) => diff.proposal.key),
  );

  // One product at a time, and cheap: the enrichment phase caps a run at five
  // proposals. Concurrency would buy nothing and would put two inserts that
  // derive the same base key into the same retry window.
  for (const { proposal, state, existing } of diffs) {
    // REPAIR, not skip. A GENERATED row that carries no ACTIVE source is not a
    // decision the catalog made — it is a create whose second half failed, and
    // the public reads drop it on the `curated_product_sources!inner` evidence
    // join. Re-running used to be a no-op against exactly this row, which is
    // what made the failure permanent. A hand-entered row is left alone: no
    // citation there is a curator's own decision, not a failed write.
    if (state !== "new") {
      if (
        state === "matched" &&
        existing?.id &&
        existing.proposedBy === "generated" &&
        isInsertableProposal(proposal)
      ) {
        try {
          await refreshGeneratedCuratedProductOrigin(
            existing.id,
            proposalOrigin(proposal),
            options.client,
          );
        } catch (error) {
          result.failed += 1;
          console.error(
            "[materializeCuratedProducts] origin refresh failed:",
            { submissionId, brandId, productId: existing.id, error },
          );
        }
      }
      if (
        existing?.id &&
        existing.hasActiveSource === false &&
        existing.proposedBy === "generated" &&
        isInsertableProposal(proposal)
      ) {
        try {
          await writeSources(existing.id, proposal, options.client);
          result.repaired += 1;
        } catch (error) {
          result.failed += 1;
          console.error(
            "[materializeCuratedProducts] source repair failed:",
            { submissionId, brandId, productId: existing.id, error },
          );
        }
        continue;
      }
      result.skipped += 1;
      continue;
    }

    if (!isInsertableProposal(proposal)) {
      result.skipped += 1;
      continue;
    }

    const visible = keptKeys.has(proposal.key);
    try {
      // `imageUrl` is deliberately absent: mirroring an image is a network fetch
      // plus a decode, and this runs inside the approval's own timeout budget.
      // `imageSourceUrl` is carried so the mirror stays available — and
      // re-checkable for usage rights — in the curated-products editor.
      const { id } = await createCuratedProduct(
        {
          brandId,
          // The PROPOSAL's key, not one re-derived from the (possibly edited)
          // name. It is the axis rejection memory is remembered on: a run
          // proposes a key, a reviewer may rename the product, and a re-derived
          // key would make the next run's proposal miss its own hidden row.
          key: proposal.key,
          nameZh: proposal.nameZh,
          nameEn: proposal.nameEn ?? null,
          category: proposal.category,
          subcategories: proposal.subcategories ?? [],
          material: proposal.material ?? [],
          officialUrl: normalizedOfficialUrl(proposal),
          imageSourceUrl: proposal.imageSourceUrl ?? null,
          productDescriptionZh: proposal.productDescriptionZh,
          visible,
          // THE TICK IS THE CHECK. `source_checked_at` is half the public
          // read's four-condition proof gate, and the only other writer is the
          // hand editor's explicit "sources checked" toggle — so stamping it
          // here has to be justified, not assumed. It is: the drawer renders
          // every proposal's citations beside its tick, so a moderator who
          // KEEPS a proposal has looked at the evidence for it. Leaving it NULL
          // published nothing at all — the row existed and no public read would
          // return it, with no error anywhere.
          //
          // Only the ticked ones, for the same reason. A hidden row is
          // rejection memory; nobody vouched for its sources, so a curator who
          // later publishes it by hand must make that check themselves rather
          // than inherit one that never happened.
          sourceCheckedAt: visible ? new Date().toISOString() : null,
          // Origin, not actor: the review queue has to be able to tell a machine
          // proposal from a curator's own row.
          proposedBy: "generated",
          ...proposalOrigin(proposal),
        },
        options.client,
      );

      await writeSources(id, proposal, options.client);

      result.created += 1;
      if (visible) result.visible += 1;
      else result.hidden += 1;
    } catch (error) {
      // Per proposal, so one failure costs one product rather than every
      // product after it. A create that landed and then lost its sources is
      // recoverable by the repair branch above on the next run.
      result.failed += 1;
      console.error("[materializeCuratedProducts] proposal write failed:", {
        submissionId,
        brandId,
        key: proposal.key,
        error,
      });
    }
  }

  return result;
}
