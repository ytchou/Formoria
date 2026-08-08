/**
 * Triages a Search Console "Not found (404)" export against the live database.
 *
 * Google's coverage report mixes URLs that are correctly gone with URLs that
 * only 404 because a rename dropped its `brand_slug_redirects` row. Both look
 * identical in the export, so the intentional 404s train you to ignore the
 * report — and the recoverable ones ride along unnoticed.
 *
 * Usage: pnpm seo:gsc-404 <path-to-export>
 *   <path-to-export> is either the Table.csv Search Console hands you or the
 *   unzipped directory containing it.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createServiceClient } from "@/lib/supabase/service";

export type GscExportRow = {
  url: string;
  lastCrawled: string;
};

export type BrandRow = {
  slug: string;
  name: string;
  status: string;
};

export type SlugRedirectRow = {
  old_slug: string;
  new_slug: string;
};

/**
 * Ordered by how much attention each deserves. `renamed-missing-redirect` is
 * the only bucket that represents lost link equity you can still recover;
 * everything below `redirect-exists` is either already healed or a 404 that is
 * the correct answer.
 */
export const TRIAGE_BUCKETS = [
  "renamed-missing-redirect",
  "redirect-exists",
  "live-approved",
  "live-hidden",
  "gone",
  "non-brand",
] as const;

export type TriageBucket = (typeof TRIAGE_BUCKETS)[number];

export type SuccessorMatch = {
  slug: string;
  name: string;
  /** Which rule proposed it — an operator must be able to audit a fuzzy match. */
  rule: "ascii-head" | "prefix" | "normalized-name";
};

export type TriageEntry = {
  /** Brand slug, or the raw pathname for `non-brand`. */
  key: string;
  bucket: TriageBucket;
  urls: string[];
  successor: SuccessorMatch | null;
  note: string;
};

export type TriageResult = {
  totalUrls: number;
  summary: Record<TriageBucket, number>;
  entries: TriageEntry[];
};

/**
 * Splits the whole document into records, not line-by-line.
 *
 * Search Console emits the URL exactly as crawled, and this directory has
 * slugs built from scraped page titles that contain a literal newline. Any
 * parser that splits on `\n` before honouring quotes tears those records in
 * half and reports two malformed URLs in place of one real 404.
 *
 * Local rather than shared: the repo's four other CSV readers are each
 * module-private too.
 */
export function parseCsvRecords(csv: string): string[][] {
  const records: string[][] = [];
  let fields: string[] = [];
  let current = "";
  let inQuotes = false;
  let pending = false;

  const endField = () => {
    fields.push(current);
    current = "";
    pending = true;
  };
  const endRecord = () => {
    endField();
    records.push(fields);
    fields = [];
    pending = false;
  };

  for (let i = 0; i < csv.length; i++) {
    const char = csv[i];
    if (inQuotes) {
      if (char !== '"') {
        current += char;
      } else if (csv[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = false;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      pending = true;
    } else if (char === ",") {
      endField();
    } else if (char === "\r") {
      // swallow; the \n that follows closes the record
    } else if (char === "\n") {
      if (pending || current.length > 0 || fields.length > 0) endRecord();
    } else {
      current += char;
    }
  }

  if (pending || current.length > 0 || fields.length > 0) endRecord();
  return records;
}

export function parseGscExport(csv: string): GscExportRow[] {
  const [header, ...body] = parseCsvRecords(csv);
  if (!header) return [];

  const columns = header.map((column) => column.trim().toLowerCase());
  const urlIndex = columns.indexOf("url");
  if (urlIndex === -1) {
    throw new Error(
      `Expected a "URL" column in the export, found: ${columns.join(", ")}`,
    );
  }
  const crawledIndex = columns.findIndex((column) =>
    column.includes("crawled"),
  );

  return body.flatMap((cells) => {
    // A newline inside a quoted URL survives parsing; strip it so the slug
    // matches what the database stores.
    const url = cells[urlIndex]?.replace(/\s+/g, " ").trim();
    if (!url) return [];
    return [
      {
        url,
        lastCrawled:
          (crawledIndex === -1 ? "" : cells[crawledIndex])?.trim() ?? "",
      },
    ];
  });
}

const BRAND_PATH = /^\/(?:en\/)?brands\/([^/]+)$/;

/**
 * Returns the brand slug a URL addresses, or null for any other path.
 *
 * Search Console reports URLs percent-encoded, and roughly a third of this
 * directory's slugs contain CJK — comparing the raw form against the database
 * silently classifies every one of them as a non-brand path.
 */
export function brandSlugFromUrl(url: string): string | null {
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(url).pathname);
  } catch {
    return null;
  }
  return BRAND_PATH.exec(pathname)?.[1] ?? null;
}

export function pathnameFromUrl(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname);
  } catch {
    return url;
  }
}

const NON_ASCII = /[^\x00-\x7F]/;

/** The leading ASCII run of a slug: `keizu-好鞋好設計` -> `keizu`. */
export function asciiHead(slug: string): string {
  const match = NON_ASCII.exec(slug);
  return (match ? slug.slice(0, match.index) : slug).replace(/-+$/, "");
}

/**
 * Strips punctuation and case while KEEPING CJK, so `HALFÔR` and `half-r` both
 * reduce to `halfr` and `京都奈口金包 Gamakuchi` keeps its Han characters.
 *
 * Dropping the CJK range here is not a cosmetic bug: every Chinese-only brand
 * name collapses to the empty string, every empty string matches every other,
 * and the matcher then proposes a redirect from each dead slug to an arbitrary
 * brand. MIN_NORMALIZED_LENGTH is the backstop.
 */
export function normalizeForMatch(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9一-鿿]/g, "");
}

/** Below this a normalized key is too generic to be evidence of anything. */
export const MIN_NORMALIZED_LENGTH = 3;

/**
 * Proposes the brand a dead slug was most likely renamed to.
 *
 * Only `approved` brands are considered: `resolveApprovedBrandRedirect` joins
 * on `brands.status = 'approved'`, so a row pointing at a hidden brand resolves
 * to null and still serves a 404 — it would look fixed while changing nothing.
 */
export function findSuccessor(
  deadSlug: string,
  brands: BrandRow[],
): SuccessorMatch | null {
  const approved = brands.filter(
    (brand) => brand.status === "approved" && brand.slug !== deadSlug,
  );

  const head = asciiHead(deadSlug);
  if (head.length >= MIN_NORMALIZED_LENGTH) {
    const exact = approved.find((brand) => brand.slug === head);
    if (exact)
      return { slug: exact.slug, name: exact.name, rule: "ascii-head" };
  }

  const prefixed = approved.find(
    (brand) =>
      brand.slug.length >= MIN_NORMALIZED_LENGTH &&
      (deadSlug.startsWith(`${brand.slug}-`) ||
        brand.slug.startsWith(`${deadSlug}-`)),
  );
  if (prefixed)
    return { slug: prefixed.slug, name: prefixed.name, rule: "prefix" };

  const key = normalizeForMatch(deadSlug);
  if (key.length >= MIN_NORMALIZED_LENGTH) {
    const named = approved.find(
      (brand) =>
        normalizeForMatch(brand.name) === key ||
        normalizeForMatch(brand.slug) === key,
    );
    if (named)
      return { slug: named.slug, name: named.name, rule: "normalized-name" };
  }

  return null;
}

function compareEntries(left: TriageEntry, right: TriageEntry): number {
  const byBucket =
    TRIAGE_BUCKETS.indexOf(left.bucket) - TRIAGE_BUCKETS.indexOf(right.bucket);
  return (
    byBucket ||
    right.urls.length - left.urls.length ||
    left.key.localeCompare(right.key)
  );
}

export function triage(
  rows: GscExportRow[],
  brands: BrandRow[],
  redirects: SlugRedirectRow[],
): TriageResult {
  const brandBySlug = new Map(brands.map((brand) => [brand.slug, brand]));
  const redirectByOldSlug = new Map(
    redirects.map((row) => [row.old_slug, row.new_slug]),
  );

  // Group first: the zh-TW and /en twins of one brand are one decision, and
  // reporting them separately doubles every count in the summary.
  const urlsByKey = new Map<string, { urls: string[]; slug: string | null }>();
  for (const row of rows) {
    const slug = brandSlugFromUrl(row.url);
    const key = slug ?? pathnameFromUrl(row.url);
    const group = urlsByKey.get(key) ?? { urls: [], slug };
    group.urls.push(row.url);
    urlsByKey.set(key, group);
  }

  const entries: TriageEntry[] = [];
  for (const [key, { urls, slug }] of urlsByKey) {
    entries.push({ key, urls, ...classify(key, slug) });
  }

  function classify(
    key: string,
    slug: string | null,
  ): Pick<TriageEntry, "bucket" | "successor" | "note"> {
    if (slug === null) {
      return {
        bucket: "non-brand",
        successor: null,
        note: "Not a brand detail URL — check it against the route table by hand.",
      };
    }

    const redirectTarget = redirectByOldSlug.get(slug);
    if (redirectTarget) {
      return {
        bucket: "redirect-exists",
        successor: null,
        note: `Already redirects to /brands/${redirectTarget}; the export predates the row.`,
      };
    }

    const brand = brandBySlug.get(slug);
    if (brand?.status === "approved") {
      return {
        bucket: "live-approved",
        successor: null,
        note: "Approved and serving today — crawled while it was hidden or unapproved.",
      };
    }
    if (brand) {
      return {
        bucket: "live-hidden",
        successor: null,
        note: `Brand exists with status "${brand.status}"; 404 is the intended response.`,
      };
    }

    const successor = findSuccessor(key, brands);
    if (successor) {
      return {
        bucket: "renamed-missing-redirect",
        successor,
        note: `Likely renamed to /brands/${successor.slug} (${successor.rule}) with no redirect row. Confirm before inserting.`,
      };
    }

    return {
      bucket: "gone",
      successor: null,
      note: "No brand and no successor — 404 is correct. It ages out of the report on its own.",
    };
  }

  const summary = Object.fromEntries(
    TRIAGE_BUCKETS.map((bucket) => [bucket, 0]),
  ) as Record<TriageBucket, number>;
  for (const entry of entries) summary[entry.bucket] += 1;

  return {
    totalUrls: rows.length,
    summary,
    entries: entries.sort(compareEntries),
  };
}

/** PostgREST caps an unbounded select at 1000 rows; page under that cap. */
const PAGE_SIZE = 1000;

async function fetchAll<T>(
  table: "brands" | "brand_slug_redirects",
  columns: string,
): Promise<T[]> {
  const client = createServiceClient();
  const rows: T[] = [];

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await client
      .from(table)
      .select(columns)
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw error;

    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }

  return rows;
}

async function readExport(target: string): Promise<string> {
  const absolute = resolve(process.cwd(), target);
  try {
    return await readFile(absolute, "utf8");
  } catch (error) {
    // Search Console ships a zip of Chart/Metadata/Table; accept the directory
    // so the usual "unzip, pass the folder" path does not fail on a bare ENOENT.
    if ((error as NodeJS.ErrnoException).code === "EISDIR") {
      return readFile(resolve(absolute, "Table.csv"), "utf8");
    }
    throw error;
  }
}

async function main(): Promise<void> {
  const target = process.argv[2];
  if (!target) {
    console.error(
      "Usage: pnpm seo:gsc-404 <path-to-Table.csv-or-export-directory>",
    );
    process.exit(1);
  }

  try {
    const rows = parseGscExport(await readExport(target));
    const [brands, redirects] = await Promise.all([
      fetchAll<BrandRow>("brands", "slug, name, status"),
      fetchAll<SlugRedirectRow>("brand_slug_redirects", "old_slug, new_slug"),
    ]);
    console.log(JSON.stringify(triage(rows, brands, redirects), null, 2));
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

// pathToFileURL, not a `file://` template: a repo path containing a space, `#`
// or non-ASCII character percent-encodes in import.meta.url, and the naive
// comparison would silently skip main() and exit 0 printing nothing.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void main();
}
