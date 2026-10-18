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

import {
  classifyNameSuffix,
  createPublicNameResolver,
  type SuffixClass,
  type SuffixKind,
} from "@/lib/curated-products/product-name";
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
 *   gtin            8/12/13/14 digits with a valid GS1 check digit, or 10
 *                   with a valid ISBN-10 check — may be a real barcode or
 *                   ISBN (even when the URL repeats it), so a human decides;
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
 * The classifier lives in `@/lib/curated-products/product-name`, which the
 * public reads share. `hiddenToday` says whether the public name resolver
 * (with every scanned row as a sibling) drops the suffix, and `collides`
 * whether removing it would leave two rows of one brand with the same name —
 * the case where the suffix is the only thing telling two products apart.
 * After DEV-2046, `hiddenToday && collides` should be 0.
 *
 * READ-ONLY: one paged select of `curated_products`; no write path is imported.
 */

const PAGE_SIZE = 500;

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
  /** The public name resolver renders the name without the token. */
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
  // The same resolver the public reads build, over every scanned row: on a
  // full scan that is every row of each brand, as on the read path.
  const resolveName = createPublicNameResolver(
    rows.map((row) => ({
      id: row.id,
      brandId: row.brand_id,
      nameZh: row.name_zh,
      nameEn: row.name_en,
      officialUrl: row.official_url,
    })),
  );

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
        hiddenToday: !resolveName(
          { id: row.id, brandId: row.brand_id, officialUrl: row.official_url },
          column,
          name,
        ).includes(suffix.token),
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
