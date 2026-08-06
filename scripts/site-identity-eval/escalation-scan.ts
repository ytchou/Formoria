/**
 * DEV-1309 offline replay: how often does Rung 1 escalate stored links?
 *
 *   pnpm exec tsx --env-file=.env.local scripts/site-identity-eval/escalation-scan.ts
 *
 * Rung 1 can only ESCALATE, never delete. A low escalation rate over stored
 * human-approved links is evidence that quarantine is not over-firing, while
 * the absolute count sizes the LLM batch Rung 2 would have to pay for. Above
 * 40% escalating is the pivot trigger: the predicate is too strict.
 *
 * This is read-only and pages the brands table beyond PostgREST's default cap.
 * Exit code is always 0: this is a report, not a write operation.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { PURCHASE_CHANNELS } from "@/lib/brands/purchase-channels";
import { brandNameTokens, linkIdentifiesBrand } from "@/lib/services/link-enrichment";

const BATCH_SIZE = 500;
const SOCIAL_COLUMNS = ["social_instagram", "social_threads", "social_facebook"] as const;
const COLUMNS = [...SOCIAL_COLUMNS, ...PURCHASE_CHANNELS.map((channel) => channel.column)];

type BrandRow = {
  slug: string;
  name: string | null;
  [column: string]: unknown;
};

type ColumnTally = {
  column: string;
  escalating: number;
  total: number;
  pct: number | null;
};

type ScanReport = {
  ranAt: string;
  columns: ColumnTally[];
  total: ColumnTally;
  hanOnlyPurchaseWebsite: number;
  rowsScanned: number;
};

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv.at(index + 1);
}

function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    );
  }

  return createSupabaseClient(url, serviceRoleKey);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function pct(tally: Pick<ColumnTally, "escalating" | "total">): number | null {
  return tally.total === 0 ? null : (tally.escalating / tally.total) * 100;
}

function printTally(tally: ColumnTally): void {
  if (tally.total === 0) {
    console.log(`${tally.column.padEnd(24)}  0/0  n/a (no stored values)`);
    return;
  }
  console.log(
    `${tally.column.padEnd(24)}  ${tally.escalating}/${tally.total}  ${tally.pct?.toFixed(1)}%`,
  );
}

function printReport(report: ScanReport): void {
  console.log("\ncolumn                    escalating/total  pct");
  console.log("-".repeat(54));
  for (const tally of report.columns) printTally(tally);
  console.log("-".repeat(54));
  printTally({ ...report.total, column: "TOTAL" });
  console.log(`\nHan-only rows with purchase_website: ${report.hanOnlyPurchaseWebsite}`);

  const totalPct = report.total.pct;
  const share = totalPct === null ? "n/a" : `${totalPct.toFixed(1)}%`;
  console.log(
    totalPct !== null && totalPct > 40
      ? `\n${share} of stored approved links escalate. PIVOT TRIGGER: >40% escalating means the predicate is too strict.`
      : `\n${share} of stored approved links escalate. Below the 40% pivot trigger.`,
  );
}

async function main(): Promise<void> {
  const outPath = argValue("--out");
  const supabase = createServiceClient();
  const tallies = new Map<string, ColumnTally>(
    COLUMNS.map((column) => [column, { column, escalating: 0, total: 0, pct: null }]),
  );
  let offset = 0;
  let rowsScanned = 0;
  let hanOnlyPurchaseWebsite = 0;
  const select = ["slug", "name", ...COLUMNS].join(", ");

  while (true) {
    const { data, error } = await supabase
      .from("brands")
      .select(select)
      .order("slug", { ascending: true })
      .range(offset, offset + BATCH_SIZE - 1);
    if (error) throw error;

    const rows = (data ?? []) as unknown as BrandRow[];
    if (rows.length === 0) break;
    rowsScanned += rows.length;

    for (const row of rows) {
      const tokens = brandNameTokens(row.name);
      if (tokens.length === 0 && isNonEmptyString(row.purchase_website)) {
        hanOnlyPurchaseWebsite += 1;
      }
      for (const column of COLUMNS) {
        const value = row[column];
        if (!isNonEmptyString(value)) continue;
        const tally = tallies.get(column);
        if (!tally) continue;
        tally.total += 1;
        if (!linkIdentifiesBrand(value, tokens)) tally.escalating += 1;
      }
    }

    if (rows.length < BATCH_SIZE) break;
    offset += BATCH_SIZE;
  }

  const columns = [...tallies.values()]
    .map((tally) => ({ ...tally, pct: pct(tally) }))
    .sort((left, right) => right.total - left.total);
  const total: ColumnTally = {
    column: "TOTAL",
    escalating: columns.reduce((sum, tally) => sum + tally.escalating, 0),
    total: columns.reduce((sum, tally) => sum + tally.total, 0),
    pct: null,
  };
  total.pct = pct(total);
  const report: ScanReport = {
    ranAt: new Date().toISOString(),
    columns,
    total,
    hanOnlyPurchaseWebsite,
    rowsScanned,
  };

  printReport(report);
  if (outPath) {
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, JSON.stringify(report, null, 2));
    console.log(`\nwrote ${outPath}`);
  }
}

void main().catch((error) => {
  console.error(
    "\nFAILED:",
    error instanceof Error
      ? (error.stack ?? error.message)
      : JSON.stringify(error),
  );
  // Still 0: a failed run is reported, not asserted.
  process.exitCode = 0;
});

export {};
