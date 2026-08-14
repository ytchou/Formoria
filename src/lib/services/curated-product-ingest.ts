import * as cheerio from "cheerio";
import {
  fetchHtmlWithMetadata,
  type FetchMetadata,
} from "@/lib/services/enrich-phases/scraper/fetch-guards";
import {
  extractAllJsonLd,
  filterHeroImage,
  firstString,
  metaContent,
  textContent,
} from "@/lib/services/enrich-phases/scraper/parse/extractors";

/**
 * Curated-product ingest: turn an official product URL into a form prefill
 * (DEV-1465).
 *
 * READ ONLY, ALWAYS. This service fetches a page and reads its published
 * metadata. It never writes a row, never calls a model, and never decides
 * anything: every value it returns is a SUGGESTION an editor must confirm
 * before it reaches `curated_products`. That is why it holds no Supabase
 * client at all — a write path that starts here would attribute a machine's
 * reading of a page to an editor's assertion.
 *
 * NO COMMERCIAL FACTS. Price, availability, offers, stock, and shipping are
 * never read, even when the page publishes them in a perfectly valid
 * schema.org `Offer`. DEV-1404 forbids them permanently: they are facts with a
 * freshness obligation nothing in this product can honour, which is why
 * `curated_products` has no column for any of them.
 *
 * DETERMINISTIC. Same HTML in, same prefill out. No model, no randomness, no
 * clock — so a prefill can be reproduced from the archived page.
 */

/** Only the fields a curated-product form can be prefilled with. */
export type CuratedProductPrefill = {
  nameZh?: string;
  nameEn?: string;
  description?: string;
  imageUrl?: string;
};

/**
 * The narrowest fetch shape this service needs. Declared for the same reason as
 * `LinkStateWriter` in `scripts/curated-products/check-links.ts`: the unit test
 * hands in a fixture-backed double instead of mocking the module, which
 * `scripts/check-test-boundaries.mjs` forbids outright for `@/lib/services/`.
 */
export type PrefillFetchPage = (url: string) => Promise<FetchMetadata>;

export type PrefillDeps = {
  /** Seam for the unit test; the default is the SSRF-guarded, audited fetch. */
  fetchPage?: PrefillFetchPage;
};

/**
 * Han characters, used only to route ONE name into the right column. A name
 * carrying Han characters is the zh-TW name; anything else is treated as the
 * Latin-script name. This is a routing heuristic on a value an editor will see
 * and can correct, never a language claim written anywhere on its own.
 */
const HAN_REGEX = /[\u4E00-\u9FFF\u3400-\u4DBF]/u;

function typeNames(node: Record<string, unknown>): string[] {
  const type = node["@type"];
  if (typeof type === "string") return [type];
  if (Array.isArray(type)) {
    return type.filter((entry): entry is string => typeof entry === "string");
  }
  return [];
}

/**
 * Depth-first walk for the first schema.org `Product` node.
 *
 * Both shapes below are common enough that missing either loses most real
 * pages: a top-level array of nodes, and a single object whose `@graph` holds
 * the nodes. `@type` is equally often a string or an array of strings.
 */
function findProductNode(
  value: unknown,
  depth = 0,
): Record<string, unknown> | null {
  if (depth > 6 || value == null || typeof value !== "object") return null;

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findProductNode(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  const node = value as Record<string, unknown>;
  if (typeNames(node).includes("Product")) return node;

  for (const key of ["@graph", "mainEntity", "itemListElement"]) {
    const found = findProductNode(node[key], depth + 1);
    if (found) return found;
  }

  return null;
}

/** Route one name into the zh-TW or the Latin-script slot, first writer wins. */
function assignName(prefill: CuratedProductPrefill, name: string | null): void {
  if (!name) return;
  if (HAN_REGEX.test(name)) {
    if (!prefill.nameZh) prefill.nameZh = name;
    return;
  }
  if (!prefill.nameEn) prefill.nameEn = name;
}

/**
 * Read an official product page and suggest form values. Returns an object with
 * only the fields the page actually published: a missing field is left absent
 * rather than filled with a placeholder, so an editor is never shown a value
 * the source never made.
 *
 * A failed fetch, an unreadable page, or a page with no metadata all yield an
 * empty prefill. Nothing here throws for a bad page — a page that cannot be
 * read is an empty form, not an error the editor has to clear.
 */
export async function prefillFromUrl(
  url: string,
  deps: PrefillDeps = {},
): Promise<CuratedProductPrefill> {
  const fetchPage = deps.fetchPage ?? fetchHtmlWithMetadata;

  const response = await fetchPage(url);
  if (!response.text) return {};

  let $: cheerio.CheerioAPI;
  try {
    $ = cheerio.load(response.text);
  } catch {
    return {};
  }

  const prefill: CuratedProductPrefill = {};

  // Layer 1: the JSON-LD `Product` node, when the page publishes one. It is the
  // publisher's own structured claim about the product, so it outranks the
  // social-preview tags, which describe the PAGE and often carry a site suffix.
  const product = findProductNode(extractAllJsonLd($));
  if (product) {
    assignName(prefill, firstString(product.name));
    assignName(prefill, firstString(product.alternateName));
    const description = firstString(product.description);
    if (description) prefill.description = description;
    const image = firstString(product.image);
    const resolved = image ? filterHeroImage(image, url) : null;
    if (resolved) prefill.imageUrl = resolved;
  }

  // Layer 2: the same order `scraper/strategies/single-page.ts` already uses,
  // filling only what the Product node left empty.
  if (!prefill.nameZh && !prefill.nameEn) {
    assignName(
      prefill,
      metaContent($, 'meta[property="og:title"]') ??
        metaContent($, 'meta[name="twitter:title"]') ??
        textContent($, "title"),
    );
  }

  if (!prefill.description) {
    const description =
      metaContent($, 'meta[property="og:description"]') ??
      metaContent($, 'meta[name="description"]');
    if (description) prefill.description = description;
  }

  if (!prefill.imageUrl) {
    const candidate =
      metaContent($, 'meta[property="og:image"]') ??
      metaContent($, 'meta[name="twitter:image"]');
    const resolved = candidate ? filterHeroImage(candidate, url) : null;
    if (resolved) prefill.imageUrl = resolved;
  }

  return prefill;
}
