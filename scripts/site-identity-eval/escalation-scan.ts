/**
 * DEV-1309 offline replay: how often does Rung 1 escalate stored links?
 *
 *   pnpm exec tsx --env-file=.env.local scripts/site-identity-eval/escalation-scan.ts
 *
 * Rung 1 can only ESCALATE, never delete. A low escalation rate over stored
 * human-approved links is evidence that quarantine is not over-firing, while
 * the absolute count sizes the LLM batch Rung 2 would have to pay for. Above
 * 40% escalating is the pivot trigger: the predicate is too strict.
 * The population is therefore approved brands only — pending rows carry
 * unvetted links that have not cleared moderation, and rejected rows are not
 * a population anything downstream acts on.
 * The zero-token cohort split sizes that legacy cohort ahead of remediation:
 * brands whose name yields no Latin token of length >= 3, which the token
 * check cannot satisfy, so every stored link they hold escalates.
 *
 * This is read-only and pages the brands table beyond PostgREST's default cap.
 * Exit code is always 0: this is a report, not a write operation.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { ONLINE_STORES } from "@/lib/brands/online-stores";
import { brandNameTokens, linkIdentifiesBrand } from "@/lib/services/link-enrichment";

const BATCH_SIZE = 500;
const SOCIAL_COLUMNS = ["social_instagram", "social_threads", "social_facebook"] as const;
const COLUMNS = [...SOCIAL_COLUMNS, ...ONLINE_STORES.map((channel) => channel.column)];

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

type CohortColumnTally = {
  column: string;
  held: number;
};

/**
 * The predicate is `brandNameTokens(name).length === 0`, which is narrower than
 * "the name is Han": a null name, or one whose only Latin tokens are shorter
 * than 3 characters, also lands here. Named for what is measured, not for the
 * cohort it is a proxy for.
 */
type ZeroTokenCohort = {
  brands: number;
  withPurchaseWebsite: number;
  columns: CohortColumnTally[];
  totalHeld: number;
};

type ScanReport = {
  ranAt: string;
  columns: ColumnTally[];
  total: ColumnTally;
  zeroTokenCohort: ZeroTokenCohort;
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

  const totalPct = report.total.pct;
  const share = totalPct === null ? "n/a" : `${totalPct.toFixed(1)}%`;
  console.log(
    totalPct !== null && totalPct > 40
      ? `\n${share} of stored approved links escalate. PIVOT TRIGGER: >40% escalating means the predicate is too strict.`
      : `\n${share} of stored approved links escalate. Below the 40% pivot trigger.`,
  );

  console.log("\nzero-token cohort");
  console.log("-".repeat(68));
  console.log(`brands scanned: ${report.zeroTokenCohort.brands}`);
  console.log(`with purchase_website: ${report.zeroTokenCohort.withPurchaseWebsite}`);
  // No escalating column here: it would equal `held` for every possible input,
  // and printing the two side by side invites a vacuous cross-check.
  console.log("\ncolumn                    held");
  console.log("-".repeat(54));
  for (const tally of report.zeroTokenCohort.columns) {
    console.log(`${tally.column.padEnd(24)}  ${String(tally.held).padStart(4)}`);
  }
  console.log("-".repeat(54));
  console.log(
    `${"TOTAL".padEnd(24)}  ${String(report.zeroTokenCohort.totalHeld).padStart(4)}`,
  );
  console.log(
    "A zero-token name cannot satisfy the token check, so every stored link in this cohort escalates by construction.",
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
  const zeroTokenTallies = new Map<string, CohortColumnTally>(
    COLUMNS.map((column) => [column, { column, held: 0 }]),
  );
  let zeroTokenBrands = 0;
  let zeroTokenWithPurchaseWebsite = 0;
  const select = ["slug", "name", ...COLUMNS].join(", ");

  while (true) {
    const { data, error } = await supabase
      .from("brands")
      .select(select)
      // Approved only: pending rows hold unvetted links that would inflate the
      // escalation rate past its own pivot trigger, and remediation will never
      // touch rows outside the approved directory.
      .eq("status", "approved")
      .order("slug", { ascending: true })
      .range(offset, offset + BATCH_SIZE - 1);
    if (error) throw error;

    const rows = (data ?? []) as unknown as BrandRow[];
    if (rows.length === 0) break;
    rowsScanned += rows.length;

    for (const row of rows) {
      const tokens = brandNameTokens(row.name);
      const isZeroTokenCohort = tokens.length === 0;
      if (isZeroTokenCohort) {
        zeroTokenBrands += 1;
        if (isNonEmptyString(row.purchase_website)) zeroTokenWithPurchaseWebsite += 1;
      }
      for (const column of COLUMNS) {
        const value = row[column];
        if (!isNonEmptyString(value)) continue;
        const tally = tallies.get(column);
        if (!tally) continue;
        tally.total += 1;
        const escalating = !linkIdentifiesBrand(value, tokens);
        if (isZeroTokenCohort) {
          const cohortTally = zeroTokenTallies.get(column);
          if (cohortTally) cohortTally.held += 1;
        }
        if (escalating) tally.escalating += 1;
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
  const zeroTokenColumns = [...zeroTokenTallies.values()].sort(
    (left, right) => right.held - left.held,
  );
  const zeroTokenCohort: ZeroTokenCohort = {
    brands: zeroTokenBrands,
    withPurchaseWebsite: zeroTokenWithPurchaseWebsite,
    columns: zeroTokenColumns,
    totalHeld: zeroTokenColumns.reduce((sum, tally) => sum + tally.held, 0),
  };
  const report: ScanReport = {
    ranAt: new Date().toISOString(),
    columns,
    total,
    zeroTokenCohort,
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
