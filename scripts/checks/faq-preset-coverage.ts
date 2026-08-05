/**
 * Coverage gate (read-only): how many approved brands actually have the data
 * behind each surviving FAQ preset (DEV-1317).
 *
 * The FAQ redesign cuts three presets. If the presets that survive are backed
 * by sparsely populated columns, the rebuilt FAQ would render FEWER items per
 * brand than today — a regression that only shows up in aggregate, never on the
 * one brand you happen to open. This measures that before the render change
 * ships.
 *
 * "Approved brand" uses the same predicate the public app uses
 * (status = 'approved' plus `excludeTestBrands`) so the numbers match what
 * visitors and crawlers see, not the raw table.
 *
 * A column counts as populated using the same semantics the render path
 * applies: strings must be non-blank, and `reputation_summary` must carry a
 * `text` string (see `normalizeReputationSummary` in lib/services/brands.ts) —
 * a bare `{}` renders nothing and is not coverage. `mit_status` gets an extra
 * line because the column is effectively never null: the app coerces null to
 * "unverified", which is a status but not an answer, so the verified/declared
 * share is the number that predicts whether the preset renders.
 *
 * This script performs NO writes of any kind.
 *
 * Usage:
 *   tsx --env-file=.env.local scripts/checks/faq-preset-coverage.ts
 */
import { createServiceClient } from "@/lib/supabase/server";
import { excludeTestBrands } from "@/lib/services/public-brand-filter";

type CoverageRow = {
  mit_status: string | null;
  /** smallint in Postgres — an ordinal bucket (1/2/3), never a string. */
  price_range: number | null;
  product_type: string | null;
  reputation_summary: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * price_range is a smallint ordinal bucket, so the text test above reports 0%
 * on a fully populated column — which reads as a failed coverage gate.
 */
function hasOrdinal(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value);
}

/** Mirrors normalizeReputationSummary: no `text` string means nothing renders. */
function hasReputationSummary(value: unknown): boolean {
  return isRecord(value) && hasText(value.text);
}

function percent(part: number, whole: number): string {
  if (whole === 0) return "n/a";
  return `${((part / whole) * 100).toFixed(1)}%`;
}

function line(label: string, count: number, total: number): string {
  return `  ${label.padEnd(20)} ${String(count).padStart(5)} / ${total}  ${percent(count, total).padStart(7)}`;
}

async function main(): Promise<void> {
  const supabase = createServiceClient();

  const { data, error, count } = await excludeTestBrands(
    supabase
      .from("brands")
      .select("mit_status, price_range, product_type, reputation_summary", {
        count: "exact",
      })
      .eq("status", "approved"),
  );

  if (error) throw error;

  const rows = (data ?? []) as CoverageRow[];
  const total = rows.length;

  console.log("[faq-preset-coverage] approved brands (public predicate)");
  console.log(`[faq-preset-coverage] total: ${total}`);

  // A short read means PostgREST capped the page; every percentage below would
  // then describe a sample, not the catalog. Say so instead of quietly lying.
  if (typeof count === "number" && count !== total) {
    console.warn(
      `[faq-preset-coverage] WARNING: read ${total} rows but the table reports ${count} — results are a partial page, re-run with paging.`,
    );
  }

  if (total === 0) {
    console.log("[faq-preset-coverage] no approved brands — nothing to report");
    return;
  }

  const mitPopulated = rows.filter((row) => hasText(row.mit_status)).length;
  const mitAnswerable = rows.filter(
    (row) => row.mit_status === "verified" || row.mit_status === "declared",
  ).length;
  const pricePopulated = rows.filter((row) =>
    hasOrdinal(row.price_range),
  ).length;
  const typePopulated = rows.filter((row) => hasText(row.product_type)).length;
  const reputationPopulated = rows.filter((row) =>
    hasReputationSummary(row.reputation_summary),
  ).length;

  console.log("\n  column                 populated / total   coverage");
  console.log("  " + "-".repeat(48));
  console.log(line("mit_status", mitPopulated, total));
  console.log(line("price_range", pricePopulated, total));
  console.log(line("product_type", typePopulated, total));
  console.log(line("reputation_summary", reputationPopulated, total));

  console.log("\n  mit_status detail (null is coerced to 'unverified' by the app)");
  console.log(line("verified+declared", mitAnswerable, total));

  const byMitStatus = new Map<string, number>();
  for (const row of rows) {
    const key = hasText(row.mit_status) ? (row.mit_status as string) : "(null)";
    byMitStatus.set(key, (byMitStatus.get(key) ?? 0) + 1);
  }
  for (const [status, n] of [...byMitStatus.entries()].sort(
    (a, b) => b[1] - a[1],
  )) {
    console.log(line(`  ${status}`, n, total));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
