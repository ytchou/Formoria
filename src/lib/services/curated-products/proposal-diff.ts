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
  "new" | "matched" | "previously-rejected";

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
  /**
   * All three are optional so every structural satisfier above keeps compiling.
   * Supplied by `getCuratedProductsByBrandBatch`, and read only by the approval
   * materializer: a `generated` row with `hasActiveSource === false` is not a
   * decision, it is a half-finished create (the product row landed, its
   * `curated_product_sources` upsert did not), and the materializer repairs it
   * instead of skipping it. `undefined` means "the caller did not ask", which is
   * why the repair is keyed on an explicit `false`.
   *
   * `proposedBy` narrows the repair to rows THIS materializer created. A curated
   * row entered by hand with no citation is a curator's own decision, not a
   * failed write, so machine-found sources must never be attached to it.
   */
  id?: string;
  hasActiveSource?: boolean;
  proposedBy?: string;
  imageSourceUrl?: string | null;
  nameEn?: string | null;
  productDescriptionZh?: string | null;
  productDescriptionEn?: string | null;
  category?: string | null;
  subcategory?: string | null;
  material?: string[] | null;
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
 * Campaign and click-id parameters: values a COPIED link carries that say
 * nothing about which page it is. Stripping is by exact name plus the `utm_`
 * prefix, never "drop the whole query string" — that is the difference between
 * removing noise and destroying identity.
 *
 * `ref` is deliberately NOT here. It reads like a referrer tag and is one on
 * most sites, but it also routes real pages on some storefronts, and this list
 * may only contain names that can never carry identity.
 */
const TRACKING_QUERY_PREFIXES = ["utm_"] as const;
const TRACKING_QUERY_PARAMS = new Set([
  "fbclid",
  "gclid",
  "gbraid",
  "wbraid",
  "dclid",
  "msclkid",
  "yclid",
  "ttclid",
  "twclid",
  "igshid",
  "li_fat_id",
  "mc_cid",
  "mc_eid",
  "srsltid",
  "_ga",
  "_gl",
]);

function isTrackingQueryParam(name: string): boolean {
  const key = name.toLowerCase();
  return (
    TRACKING_QUERY_PARAMS.has(key) ||
    TRACKING_QUERY_PREFIXES.some((prefix) => key.startsWith(prefix))
  );
}

/**
 * "Is this the same page?" reduced to a host, a path, and the identity-bearing
 * half of the query string: the scheme, a `www.` prefix, a trailing slash and
 * the campaign parameters a copied link carries are all noise, and a product
 * URL that differs only in those names one page.
 *
 * THE QUERY STRING IS NOT DISCARDED. Plenty of Taiwanese cart platforms key a
 * product BY query string — `shop.tw/products/detail?id=123`,
 * `shop.tw/product.php?pid=456` — so dropping it wholesale collapsed every
 * product such a brand sells onto one diff key. `indexExistingProducts` keeps
 * the first row per key, so a single stored product then answered for the whole
 * line: every later proposal resolved to it, was classified matched or
 * previously-rejected, and was silently never created. What survives is
 * everything that is not a known tracking parameter, sorted so parameter order
 * cannot fork one page into two keys.
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
    const identityParams = [...url.searchParams]
      .filter(([name]) => !isTrackingQueryParam(name))
      .sort(([left], [right]) => left.localeCompare(right));
    const query = new URLSearchParams(identityParams).toString();
    return `${host}${url.pathname.replace(/\/+$/, "")}${query ? `?${query}` : ""}`;
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
