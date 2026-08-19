import type { CuratedProductProposal } from "@/lib/types/enriched-data";

/**
 * Rejection memory for generated curated-product proposals (DEV-1469).
 *
 * PURE, AND DELIBERATELY SO. No Supabase client, no clock, no fetch: the caller
 * supplies the brand's existing rows, which is what lets the admin review run
 * this in the browser and the approval path run the same function on the server
 * before it creates anything.
 *
 * It exists because `createCuratedProduct` resolves a `(brand_id, key)`
 * collision by SUFFIXING (`curated-products.ts`, looping `MAX_KEY_ATTEMPTS`
 * times over `withSlugSuffix`) and `key` is derived from the product name. A
 * re-run of a product an editor already rejected would therefore insert
 * happily as `…-2` and read as brand new, which defeats rejection memory
 * entirely. Every create path must diff FIRST and skip anything already known.
 */

/**
 * `matched` — the brand already has this product, published.
 * `previously-rejected` — it has it hidden, which is how a rejection is
 * recorded (a rejected proposal materializes as `visible = false`, never as a
 * delete), so re-proposing it must not read as new.
 * `new` — nothing in the brand's catalog answers to this URL or this key.
 */
export type CuratedProductProposalState =
  | "new"
  | "matched"
  | "previously-rejected";

/**
 * The minimum a diff needs from a `curated_products` row. Structural on
 * purpose: `CuratedProduct`, `AdminCuratedProduct`, and a hand-rolled
 * `select("key, official_url, visible")` all satisfy it, so no caller has to
 * widen its read to use this.
 *
 * The rows MUST already be scoped to the brand being reviewed. Keys are unique
 * per brand and a product URL says nothing about ownership, so a cross-brand
 * list would let one brand's catalog silence another brand's proposals.
 */
export type ExistingCuratedProduct = {
  key: string;
  officialUrl: string | null;
  /** `false` is the rejection record, not a delete. */
  visible: boolean;
};

export type CuratedProductProposalDiff<
  Row extends ExistingCuratedProduct = ExistingCuratedProduct,
> = {
  proposal: CuratedProductProposal;
  state: CuratedProductProposalState;
  /** The row the proposal resolved to, or `null` when it is new. */
  existing: Row | null;
};

/**
 * "Is this the same page?" reduced to a host and a path: the scheme, a `www.`
 * prefix, a trailing slash, and the query string a copied link carries are all
 * noise, and a product URL that differs only in those names one page.
 *
 * `pageKey` in `link-enrichment.ts` answers the same question, and is NOT
 * reused here: that module reaches `input-detector`, which pulls in cheerio and
 * the SSRF-guarded fetch, and this module is imported by a client component.
 * The one behavioural difference is deliberate — only the host is lowercased,
 * because a path is case-sensitive on plenty of storefronts.
 *
 * Returns `null` for a blank value so an absent URL falls through to the key
 * rather than matching every other row that also has no URL.
 */
function urlDiffKey(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    return `${host}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    // Not parseable as a URL. Compared as an opaque string rather than
    // discarded: a stored value that is not a URL is still an identity.
    return trimmed.toLowerCase().replace(/\/+$/, "");
  }
}

/** Keys are slugs, so case and surrounding space are never meaningful. */
function slugDiffKey(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

function indexExistingProducts<Row extends ExistingCuratedProduct>(
  existingProducts: readonly Row[],
): { byUrl: Map<string, Row>; byKey: Map<string, Row> } {
  const byUrl = new Map<string, Row>();
  const byKey = new Map<string, Row>();

  for (const row of existingProducts) {
    const url = urlDiffKey(row.officialUrl);
    // First row wins on a duplicate. A brand with two rows for one URL is
    // already a data defect; picking the earlier one at least makes the diff
    // deterministic instead of order-of-arrival dependent.
    if (url && !byUrl.has(url)) byUrl.set(url, row);
    const key = slugDiffKey(row.key);
    if (key && !byKey.has(key)) byKey.set(key, row);
  }

  return { byUrl, byKey };
}

/**
 * Classifies every proposal against the brand's existing products.
 *
 * `officialUrl` wins, `key` is the fallback. That order is the whole design:
 * the key is name-derived, so an editor who renames a row breaks key matching
 * while the URL survives — and worse, two different products sharing a name
 * would collide on the key. The key still has to exist as a fallback because
 * URL stability across runs is an assumption, not a fact: a brand that
 * re-platforms its shop re-links every product, and the key is then the only
 * thing that remembers the rejection.
 *
 * Proposals are classified independently: two proposals pointing at one
 * existing row both resolve to it. Neither is created, so nothing downstream
 * has to break the tie.
 */
export function diffCuratedProductProposals<
  Row extends ExistingCuratedProduct = ExistingCuratedProduct,
>(
  proposals: readonly CuratedProductProposal[],
  existingProducts: readonly Row[],
): CuratedProductProposalDiff<Row>[] {
  const { byUrl, byKey } = indexExistingProducts(existingProducts);

  return proposals.map((proposal) => {
    const url = urlDiffKey(proposal.officialUrl);
    const key = slugDiffKey(proposal.key);
    const existing =
      (url ? byUrl.get(url) : undefined) ??
      (key ? byKey.get(key) : undefined) ??
      null;

    if (!existing) return { proposal, state: "new" as const, existing: null };

    return {
      proposal,
      state: existing.visible
        ? ("matched" as const)
        : ("previously-rejected" as const),
      existing,
    };
  });
}
