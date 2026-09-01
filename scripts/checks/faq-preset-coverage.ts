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
 * applies: strings must be non-blank.
 *
 * This script performs NO writes of any kind.
 *
 * Usage:
 *   tsx --env-file=.env.local scripts/checks/faq-preset-coverage.ts
 */
import { createServiceClient } from "@/lib/supabase/service";
import { excludeTestBrands } from "@/lib/services/public-brand-filter";

type CoverageRow = {
  category: string | null;
};

function hasText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
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
      .select("category", {
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

  const typePopulated = rows.filter((row) => hasText(row.category)).length;

  console.log("\n  column                 populated / total   coverage");
  console.log("  " + "-".repeat(48));
  console.log(line("category", typePopulated, total));

}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
