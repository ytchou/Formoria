import {
  createCuratedProduct,
  getOriginCandidateUrls,
  getCuratedProductsByBrandBatch,
  refreshGeneratedCuratedProductOrigin,
  updateCuratedProduct,
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
import type { ProductPageEvidence } from "@/lib/services/enrich-phases/products/read-page";
import { selectAcrossPages } from "@/lib/services/enrich-phases/products/select-evidence";
import { fetchLangfusePromptWithMeta, type PromptMeta } from "@/lib/langfuse/prompt";
import { PRODUCTS_LABELS } from "@/lib/prompts/products";
import { checkDescriptionOrigin } from "@/lib/services/enrich-phases/products/verify";
import { formatOriginExcerptLine } from "@/lib/services/enrich-phases/products";
import { mapWithConcurrency } from "@/lib/services/_shared/concurrency";
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
   * not cost the rest — and the count is what tells the caller the run
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
  // Parallel: each citation is its own round trip plus an
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

// ---------------------------------------------------------------------------
// rewriteGeneratedDescriptions — DEV-1709
// ---------------------------------------------------------------------------

export type RewriteDescriptionsDeps = {
  fetchGeneratedProducts: (brandSlug?: string) => Promise<GeneratedProductRow[]>;
  readPage: (url: string) => Promise<ProductPageEvidence>;
  /** Defaults to the `products-describe` prompt via `fetchLangfusePromptWithMeta`. */
  fetchPrompt?: () => Promise<{
    text: string;
    prompt: PromptMeta["prompt"];
  }>;
  /** `prompt` is the meta `fetchPrompt` returned, for the audit context. */
  callLlm: (
    system: string,
    user: string,
    prompt: PromptMeta["prompt"],
  ) => Promise<{ text: string }>;
  verifyDescription: (input: {
    nameZh: string;
    productDescriptionZh: string;
  }) => string[];
  updateProduct: (
    id: string,
    input: { productDescriptionZh: string },
  ) => Promise<void>;
};

export type GeneratedProductRow = {
  id: string;
  nameZh: string;
  officialUrl: string | null;
  category: string;
  subcategory: string | null;
  productDescriptionZh: string;
  brandSlug: string;
  brandName: string;
};

export type RewriteDescriptionsOptions = {
  apply: boolean;
  brandSlug?: string;
};

type SkippedProduct = {
  id: string;
  nameZh: string;
  brandSlug: string;
  reason: string;
};

type FailedProduct = {
  id: string;
  nameZh: string;
  brandSlug: string;
  error: string;
};

type DescriptionDiff = {
  id: string;
  nameZh: string;
  brandSlug: string;
  old: string;
  new: string;
};

type OriginOmittedProduct = {
  id: string;
  nameZh: string;
  brandSlug: string;
};

export type RewriteDescriptionsResult = {
  total: number;
  rewritten: number;
  skipped: SkippedProduct[];
  failed: FailedProduct[];
  diffs: DescriptionDiff[];
  /**
   * Written descriptions whose page states Taiwan origin but whose text does
   * not carry it (DEV-1856). Soft: the row is still written under `apply`.
   */
  originOmitted: OriginOmittedProduct[];
};

/**
 * Extracts a JSON body from an LLM response, stripping optional markdown fences.
 * Local helper — the `agents/runtime.ts` copy has heavy graph deps we don't want.
 */
function extractJsonFromResponse(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  return (fenced?.[1] ?? text).trim();
}

/**
 * Rewrites generated product descriptions by reading each product's official
 * page and asking an LLM to produce a better description from real evidence.
 *
 * Called from `batch-populate.ts --rewrite-descriptions`. Every external call
 * arrives through `deps` so the function is testable without Supabase, OpenAI,
 * or Langfuse.
 */
export async function rewriteGeneratedDescriptions(
  deps: RewriteDescriptionsDeps,
  options: RewriteDescriptionsOptions,
): Promise<RewriteDescriptionsResult> {
  const products = await deps.fetchGeneratedProducts(options.brandSlug);

  const skipped: SkippedProduct[] = [];
  const failed: FailedProduct[] = [];
  const diffs: DescriptionDiff[] = [];
  const originOmitted: OriginOmittedProduct[] = [];

  if (products.length === 0) {
    return { total: 0, rewritten: 0, skipped, failed, diffs, originOmitted };
  }

  // Fetch prompt once
  const { text: promptText, prompt: promptMeta } = await (
    deps.fetchPrompt ?? (() => fetchLangfusePromptWithMeta("products-describe"))
  )();

  // Group by brand
  const byBrand = new Map<string, GeneratedProductRow[]>();
  for (const p of products) {
    const list = byBrand.get(p.brandSlug) ?? [];
    list.push(p);
    byBrand.set(p.brandSlug, list);
  }

  // Process brands sequentially
  for (const [brandSlug, brandProducts] of byBrand) {
    // Filter products without official URL
    const withUrl: GeneratedProductRow[] = [];
    for (const p of brandProducts) {
      if (!p.officialUrl) {
        skipped.push({
          id: p.id,
          nameZh: p.nameZh,
          brandSlug: p.brandSlug,
          reason: "no_official_url",
        });
      } else {
        withUrl.push(p);
      }
    }

    if (withUrl.length === 0) continue;

    // Warn on duplicate nameZh within a brand — the Map lookup would silently
    // assign the same description to both products
    const seenNames = new Map<string, string>();
    const deduped: GeneratedProductRow[] = [];
    for (const p of withUrl) {
      const existing = seenNames.get(p.nameZh);
      if (existing) {
        skipped.push({
          id: p.id,
          nameZh: p.nameZh,
          brandSlug: p.brandSlug,
          reason: `duplicate_name_zh:${existing}`,
        });
      } else {
        seenNames.set(p.nameZh, p.id);
        deduped.push(p);
      }
    }

    if (deduped.length === 0) continue;

    // Read pages with bounded concurrency
    const pageResults = await mapWithConcurrency(deduped, 5, async (p) => {
      try {
        const evidence = await deps.readPage(p.officialUrl!);
        return { product: p, evidence, error: null };
      } catch (err) {
        return {
          product: p,
          evidence: null,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    });

    // Filter out page-read failures
    const readable: Array<{
      product: GeneratedProductRow;
      evidence: ProductPageEvidence;
    }> = [];
    for (const r of pageResults) {
      if (r.evidence === null || (!r.evidence.mainText.trim() && r.evidence.statusCode !== 200)) {
        skipped.push({
          id: r.product.id,
          nameZh: r.product.nameZh,
          brandSlug: r.product.brandSlug,
          reason: "page_read_failed",
        });
      } else {
        readable.push({
          product: r.product,
          evidence: r.evidence,
        });
      }
    }

    if (readable.length === 0) continue;

    // Drop blocks repeated across this brand's pages before they reach the
    // prompt (DEV-1855). Same length and order as `readable`.
    const selectedEvidence = selectAcrossPages(readable.map((r) => r.evidence));
    const promptPages = readable.map((r, i) => ({
      product: r.product,
      evidence: selectedEvidence[i]!,
    }));

    // Build user content
    const userParts = [`品牌名稱：${readable[0]!.product.brandName}`];
    for (const { product, evidence } of promptPages) {
      userParts.push(
        [
          `---`,
          `產品名稱：${product.nameZh}`,
          `分類：${product.category}${product.subcategory ? ` / ${product.subcategory}` : ""}`,
          `官方連結：${product.officialUrl}`,
          `頁面標題：${evidence.title ?? ""}`,
          `頁面描述：${evidence.description ?? ""}`,
          `頁面內文：${evidence.mainText}`,
          // Origin before the existing description, which often omits it and
          // otherwise anchors the rewrite (DEV-1856 dry run).
          ...(evidence.originExcerpts.length > 0
            ? [
                PRODUCTS_LABELS.originExcerpts,
                ...evidence.originExcerpts.map((excerpt) =>
                  formatOriginExcerptLine(evidence.url, excerpt),
                ),
              ]
            : []),
          `現有描述（參考）：${product.productDescriptionZh}`,
        ].join("\n"),
      );
    }
    const userContent = userParts.join("\n\n");

    // Call LLM
    let llmResults: Array<{
      nameZh: string;
      productDescriptionZh: string;
    }>;
    try {
      const response = await deps.callLlm(promptText, userContent, promptMeta);
      const raw = extractJsonFromResponse(response.text);
      llmResults = JSON.parse(raw) as Array<{
        nameZh: string;
        productDescriptionZh: string;
      }>;
    } catch (err) {
      // LLM or parse failure: all products in this brand batch fail
      for (const { product } of readable) {
        failed.push({
          id: product.id,
          nameZh: product.nameZh,
          brandSlug: product.brandSlug,
          error: `llm_error: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      continue;
    }

    // Guard: LLM may return a non-array JSON value
    if (!Array.isArray(llmResults)) {
      for (const { product } of readable) {
        failed.push({
          id: product.id,
          nameZh: product.nameZh,
          brandSlug: product.brandSlug,
          error: "llm_error: response is not a JSON array",
        });
      }
      continue;
    }

    // Match by nameZh
    const descByName = new Map(
      llmResults.map((r) => [r.nameZh, r.productDescriptionZh]),
    );

    for (const { product, evidence } of promptPages) {
      const newDesc = descByName.get(product.nameZh);
      if (newDesc === undefined) {
        skipped.push({
          id: product.id,
          nameZh: product.nameZh,
          brandSlug: product.brandSlug,
          reason: "llm_omitted",
        });
        continue;
      }
      if (!newDesc || typeof newDesc !== "string") {
        skipped.push({
          id: product.id,
          nameZh: product.nameZh,
          brandSlug: product.brandSlug,
          reason: "llm_invalid_description",
        });
        continue;
      }

      // Verify
      const failures = deps.verifyDescription({
        nameZh: product.nameZh,
        productDescriptionZh: newDesc,
      });
      if (failures.length > 0) {
        skipped.push({
          id: product.id,
          nameZh: product.nameZh,
          brandSlug: product.brandSlug,
          reason: `verify_failed:${failures.join(",")}`,
        });
        continue;
      }

      // Soft origin check (DEV-1856): reported, never blocks the write.
      const originFailure = checkDescriptionOrigin({
        productDescriptionZh: newDesc,
        originExcerpts: evidence.originExcerpts,
        mainText: evidence.mainText,
      });

      // Write if apply
      if (options.apply) {
        try {
          await deps.updateProduct(product.id, {
            productDescriptionZh: newDesc,
          });
        } catch (err) {
          failed.push({
            id: product.id,
            nameZh: product.nameZh,
            brandSlug: product.brandSlug,
            error: err instanceof Error ? err.message : String(err),
          });
          continue;
        }
      }

      if (originFailure !== null) {
        originOmitted.push({
          id: product.id,
          nameZh: product.nameZh,
          brandSlug: product.brandSlug,
        });
      }
      diffs.push({
        id: product.id,
        nameZh: product.nameZh,
        brandSlug,
        old: product.productDescriptionZh,
        new: newDesc,
      });
    }
  }

  return {
    total: products.length,
    rewritten: diffs.length,
    skipped,
    failed,
    diffs,
    originOmitted,
  };
}

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
      diffs
        .filter((diff) => diff.state === "new")
        .map((diff) => diff.proposal.key),
  );

  const processDiff = async ({
    proposal,
    state,
    existing,
  }: (typeof diffs)[number]) => {
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
          console.error("[materializeCuratedProducts] origin refresh failed:", {
            submissionId,
            brandId,
            productId: existing.id,
            error,
          });
        }
      }
      if (
        state === "matched" &&
        existing?.id &&
        existing.proposedBy === "generated"
      ) {
        const gapFill: Partial<{
          imageSourceUrl: string;
          nameEn: string;
          productDescriptionZh: string;
          subcategory: string;
          category: string;
        }> = {};
        if (!existing.imageSourceUrl && proposal.imageSourceUrl)
          gapFill.imageSourceUrl = proposal.imageSourceUrl;
        if (!existing.nameEn && proposal.nameEn)
          gapFill.nameEn = proposal.nameEn;
        if (!existing.productDescriptionZh && proposal.productDescriptionZh)
          gapFill.productDescriptionZh = proposal.productDescriptionZh;
        if (!existing.subcategory && proposal.subcategory) {
          gapFill.subcategory = proposal.subcategory;
          gapFill.category = proposal.category;
        }

        if (Object.keys(gapFill).length > 0) {
          try {
            await updateCuratedProduct(existing.id, gapFill, options.client);
            result.repaired += 1;
          } catch (error) {
            result.failed += 1;
            console.error("[materializeCuratedProducts] gap-fill failed:", {
              submissionId,
              brandId,
              productId: existing.id,
              error,
            });
          }
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
          console.error("[materializeCuratedProducts] source repair failed:", {
            submissionId,
            brandId,
            productId: existing.id,
            error,
          });
        }
        return;
      }
      result.skipped += 1;
      return;
    }

    if (!isInsertableProposal(proposal)) {
      result.skipped += 1;
      return;
    }

    const publishAfterEvidence =
      keptKeys.has(proposal.key) && Boolean(proposal.subcategory);
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
          subcategory: proposal.subcategory ?? null,
          material: proposal.material ?? [],
          officialUrl: normalizedOfficialUrl(proposal),
          imageSourceUrl: proposal.imageSourceUrl ?? null,
          productDescriptionZh: proposal.productDescriptionZh,
          visible: false,
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
          sourceCheckedAt: publishAfterEvidence
            ? new Date().toISOString()
            : null,
          // Origin, not actor: the review queue has to be able to tell a machine
          // proposal from a curator's own row.
          proposedBy: "generated",
          ...proposalOrigin(proposal),
        },
        options.client,
      );

      await writeSources(id, proposal, options.client);
      if (publishAfterEvidence) {
        await updateCuratedProduct(id, { visible: true }, options.client);
      }

      result.created += 1;
      if (publishAfterEvidence) result.visible += 1;
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
  };

  let nextDiff = 0;
  const workers = Array.from(
    { length: Math.min(4, diffs.length) },
    async () => {
      while (nextDiff < diffs.length) {
        const diff = diffs[nextDiff];
        nextDiff += 1;
        if (diff) await processDiff(diff);
      }
    },
  );
  await Promise.all(workers);

  return result;
}
