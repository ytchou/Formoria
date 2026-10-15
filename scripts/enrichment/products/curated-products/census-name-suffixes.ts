/**
 * @formoria-script
 * purpose: Read-only census of trailing identifier suffixes on curated-product names, classified by what the suffix is (DEV-2017).
 * class: validator
 * invoke: pnpm exec tsx scripts/enrichment/products/curated-products/census-name-suffixes.ts
 * target: staging-default
 * safety: read-only
 * owner: engineering
 * notes: evidence for the DEV-2017 display-name policy; writes nothing, renames nothing
 */
import { writeFileSync } from "node:fs";

import { publicCuratedProductName } from "@/lib/curated-products/product-name";
import { createServiceClient } from "@/lib/supabase/service";

import { loadScriptTarget } from "../../../shared/target";
import { fetchAllRows, parseBrandOption } from "./shared";

/**
 * What the trailing token of a curated-product name is (DEV-2017).
 *
 *   pnpm exec tsx scripts/enrichment/products/curated-products/census-name-suffixes.ts
 *   …--brand=<slug>          one brand only
 *   …--json=<path>           also write every classified row to a JSON file
 *   …--target=production     defaults to staging; see scripts/shared/target.ts
 *
 * The ticket's question is whether a number such as the one in
 * 「肌膚急救箱 3040094558316」 can leave the displayed name. Numeric shape is
 * not evidence either way, so this classifies each suffix by what can be
 * checked without a network call:
 *
 *   gtin            8/12/13/14 digits with a valid GS1 check digit — may be a
 *                   real barcode or ISBN (even when the URL repeats it), so a
 *                   human decides;
 *   url_listing_id  5+ digits, no valid check digit, and a whole segment of
 *                   the row's own `official_url` — the shop's listing number,
 *                   already carried by the destination the product links to;
 *   long_number     5+ digits, neither of the above — unknown, a human decides;
 *   model_code      letters and digits together (`DKGP730`, `LA034-000-OBK`) —
 *                   the model identity, kept; `inUrl` marks a code the shop
 *                   also uses as its URL handle;
 *   quantity        a number with a unit (`500ml`, `2入`) — the variant, kept;
 *   short_number    1–4 digits (`2`, `2024`) — a version, size or year, kept.
 *
 * `hiddenToday` says whether `publicCuratedProductName` already drops the
 * suffix on public reads, and `collides` whether removing it would leave two
 * rows of one brand with the same name — the case where the suffix is the
 * only thing telling two products apart.
 *
 * READ-ONLY: one paged select of `curated_products`; no write path is imported.
 */

const PAGE_SIZE = 500;

export type SuffixKind =
  | "url_listing_id"
  | "gtin"
  | "long_number"
  | "model_code"
  | "quantity"
  | "short_number";

export type SuffixClass = {
  kind: SuffixKind;
  token: string;
  /** The name with the token (and the space before it) removed. */
  head: string;
  /** The token is a whole segment of the row's `official_url`. */
  inUrl: boolean;
};

/** A Han, kana, or CJK/fullwidth punctuation character. */
const CJK =
  "\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\u3000-\\u303f\\uff00-\\uffef";

/** A whitespace-separated last token. */
const SPACED_TAIL = /\s+(\S+)$/u;

/** 5+ digits glued to CJK text with no space: 「肌膚急救箱3040094558316」. */
const GLUED_DIGITS = new RegExp(`(?<=[${CJK}])(\\d{5,})$`, "u");

/** Only identifier-shaped tokens are suffixes; a trailing word is name. */
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/**
 * A count or measure. Units seen in shop names; deliberately short so a model
 * code such as `A5210009` never reads as a quantity.
 */
const QUANTITY =
  /^\d+(?:\.\d+)?(?:ml|mL|ML|l|L|g|kg|mg|cm|mm|m|oz|mAh|W|V|吋|寸|入|件|組|片|包|盒|支|瓶|罐|個|顆|枚|條|雙|號|色|款|cc|CC|-[Pp]ack)$/u;

/** True when `digits` carries a valid GS1 check digit (EAN-8, UPC-A, EAN-13, GTIN-14). */
export function hasGs1CheckDigit(digits: string): boolean {
  if (!/^\d+$/.test(digits) || ![8, 12, 13, 14].includes(digits.length)) {
    return false;
  }
  const body = digits.slice(0, -1);
  let sum = 0;
  // Weights run 3,1,3,… from the digit nearest the check digit.
  for (let i = 0; i < body.length; i += 1) {
    const digit = Number(body[body.length - 1 - i]);
    sum += digit * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10 === Number(digits.at(-1));
}

/**
 * The URL's path and query split on separators, decoded and lowercased, so a
 * listing ID is matched as a whole segment (`/item/3040094558316/…`,
 * `?id=123456`) and never as a substring of something longer.
 */
function urlSegments(officialUrl: string | null): Set<string> {
  if (!officialUrl) return new Set();
  let url: URL;
  try {
    url = new URL(officialUrl);
  } catch {
    return new Set();
  }
  let text = `${url.pathname}${url.search}`;
  try {
    text = decodeURIComponent(text);
  } catch {
    // A malformed escape: match against the raw text instead.
  }
  return new Set(
    text
      .toLowerCase()
      .split(/[\s/?&=#.,_\-+%]+/u)
      .filter(Boolean),
  );
}

/**
 * Pure: the trailing identifier of a product name and what it is, or null
 * when the name ends in a word. Never decides removal — it reports evidence.
 */
export function classifyNameSuffix(
  name: string,
  officialUrl: string | null,
): SuffixClass | null {
  const trimmed = name.trim();
  const spaced = SPACED_TAIL.exec(trimmed);
  const glued = spaced ? null : GLUED_DIGITS.exec(trimmed);
  const match = spaced ?? glued;
  if (!match) return null;

  const token = match[1]!;
  const head = trimmed.slice(0, match.index).trim();
  if (!head) return null;

  if (QUANTITY.test(token))
    return { kind: "quantity", token, head, inUrl: false };
  if (!IDENTIFIER.test(token)) return null;
  // A Latin word (`Mini`, `Cream`) is name, even when the URL slug repeats it.
  if (!/\d/.test(token)) return null;

  const inUrl = urlSegments(officialUrl).has(token.toLowerCase());
  if (!/^\d+$/.test(token)) return { kind: "model_code", token, head, inUrl };
  // Before the URL test: a shop may use the barcode or ISBN as its handle
  // (`tobecraft.com/products/9784529072441`), and then it is still the
  // product's identity, not a disposable listing number.
  if (hasGs1CheckDigit(token)) return { kind: "gtin", token, head, inUrl };
  if (token.length < 5) return { kind: "short_number", token, head, inUrl };
  if (inUrl) return { kind: "url_listing_id", token, head, inUrl };
  return { kind: "long_number", token, head, inUrl };
}

export type CensusRow = {
  id: string;
  brand_id: string;
  name_zh: string;
  name_en: string | null;
  official_url: string | null;
  visible: boolean;
  brands?: { slug: string } | { slug: string }[] | null;
};

export type ClassifiedName = {
  id: string;
  brandSlug: string | null;
  visible: boolean;
  column: "name_zh" | "name_en";
  name: string;
  officialUrl: string | null;
  suffix: SuffixClass;
  /** `publicCuratedProductName` already renders the name without the token. */
  hiddenToday: boolean;
  /** Another row of the same brand has this row's head as its full or head name. */
  collides: boolean;
};

function brandSlugOf(row: CensusRow): string | null {
  const brands = Array.isArray(row.brands) ? row.brands[0] : row.brands;
  return brands?.slug ?? null;
}

/**
 * Pure: every name with an identifier suffix, classified, with the two facts
 * the policy turns on — is it hidden already, and would hiding it merge two
 * products on the page.
 */
export function censusNameSuffixes(
  rows: readonly CensusRow[],
): ClassifiedName[] {
  // Per brand and column: how many rows would display each bare name.
  const bareNames = new Map<string, number>();
  const pending: ClassifiedName[] = [];

  for (const row of rows) {
    for (const column of ["name_zh", "name_en"] as const) {
      const name = row[column];
      if (!name) continue;
      const suffix = classifyNameSuffix(name, row.official_url);
      const bare = suffix ? suffix.head : name.trim();
      const key = `${row.brand_id}\u0000${column}\u0000${bare}`;
      bareNames.set(key, (bareNames.get(key) ?? 0) + 1);
      if (!suffix) continue;
      pending.push({
        id: row.id,
        brandSlug: brandSlugOf(row),
        visible: row.visible,
        column,
        name,
        officialUrl: row.official_url,
        suffix,
        hiddenToday: !publicCuratedProductName(name).includes(suffix.token),
        collides: false,
      });
    }
  }

  const brandOf = new Map(rows.map((row) => [row.id, row.brand_id]));
  return pending.map((item) => {
    const key = `${brandOf.get(item.id)}\u0000${item.column}\u0000${item.suffix.head}`;
    return { ...item, collides: (bareNames.get(key) ?? 0) > 1 };
  });
}

export type CensusSummary = {
  rows: number;
  names: number;
  withSuffix: number;
  byKind: Record<
    SuffixKind,
    { total: number; visible: number; hiddenToday: number; collides: number }
  >;
};

/** Pure: counts per kind, so the policy doc quotes numbers, not impressions. */
export function summarizeCensus(
  rows: readonly CensusRow[],
  classified: readonly ClassifiedName[],
): CensusSummary {
  const kinds: SuffixKind[] = [
    "url_listing_id",
    "gtin",
    "long_number",
    "model_code",
    "quantity",
    "short_number",
  ];
  const byKind = Object.fromEntries(
    kinds.map((kind) => [
      kind,
      { total: 0, visible: 0, hiddenToday: 0, collides: 0 },
    ]),
  ) as CensusSummary["byKind"];
  for (const item of classified) {
    const bucket = byKind[item.suffix.kind];
    bucket.total += 1;
    if (item.visible) bucket.visible += 1;
    if (item.hiddenToday) bucket.hiddenToday += 1;
    if (item.collides) bucket.collides += 1;
  }
  return {
    rows: rows.length,
    names: rows.reduce((n, row) => n + 1 + (row.name_en ? 1 : 0), 0),
    withSuffix: classified.length,
    byKind,
  };
}

function parseJsonPath(argv: readonly string[]): string | null {
  const flag = argv.find((arg) => arg.startsWith("--json="));
  return flag ? flag.slice("--json=".length) || null : null;
}

/** Paged with a stable order: an unpaged read stops at `db-max-rows`. */
async function loadRows(brandSlug: string | null): Promise<CensusRow[]> {
  const supabase = createServiceClient();
  return fetchAllRows<CensusRow>(
    "curated_products",
    (from, to) => {
      let query = supabase
        .from("curated_products")
        .select(
          "id, brand_id, name_zh, name_en, official_url, visible, brands!inner(slug)",
        );
      if (brandSlug) query = query.eq("brands.slug", brandSlug);
      return query.order("id", { ascending: true }).range(from, to);
    },
    PAGE_SIZE,
  );
}

async function main(): Promise<void> {
  const { argv } = loadScriptTarget();
  const brandSlug = parseBrandOption(argv);
  const jsonPath = parseJsonPath(argv);

  const rows = await loadRows(brandSlug);
  const classified = censusNameSuffixes(rows);
  console.log(JSON.stringify(summarizeCensus(rows, classified), null, 2));
  for (const item of classified) {
    console.log(
      [
        item.suffix.kind,
        item.visible ? "visible" : "hidden-row",
        item.hiddenToday ? "hidden-today" : "renders",
        item.collides ? "COLLIDES" : "",
        item.brandSlug ?? "?",
        item.column,
        item.name,
        item.officialUrl ?? "",
      ].join(" | "),
    );
  }
  if (jsonPath) {
    writeFileSync(jsonPath, `${JSON.stringify(classified, null, 2)}\n`);
    console.log(JSON.stringify({ json: jsonPath, entries: classified.length }));
  }
}

// The test imports the pure functions, so importing must never start a run.
if (process.argv[1]?.endsWith("curated-products/census-name-suffixes.ts")) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
