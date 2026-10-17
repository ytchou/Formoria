/**
 * @formoria-script
 * purpose: Applies a human-reviewed manifest of dead curated-product links — a replacement official_url, or retiring the product.
 * class: operator
 * invoke: pnpm exec tsx scripts/enrichment/products/curated-products/repair-dead-links.ts
 * target: staging-default
 * safety: writes-on-apply
 * owner: engineering
 */
import { existsSync, readFileSync } from "node:fs";

import type { CheckUrlResult } from "@/lib/services/link-checks/check-url";

import { loadScriptTarget, type ScriptTarget } from "../../../shared/target";
import { STAGING_REVALIDATION_SKIPPED } from "./normalize-names";
import { assertRevalidationConfigured, fetchAllRows, parseApplyOption } from "./shared";

/**
 * Repairs curated products whose `official_url` the weekly link check proved
 * dead (DEV-2043, follow-up of DEV-1925).
 *
 * The link checker only records the verdict (`link_state = 'broken'`), which
 * suppresses the product's call-to-action. Nothing finds where the product
 * went, so the same rows re-fire every week. Finding the new page is research,
 * not a query, so the manifest is written by a person (or an agent a person
 * reviews), and this script only applies it:
 *
 *   1. manifest — one entry per dead product: `proposal` is "replace" (with a
 *      `newUrl` on the brand's own site), "retire" (no longer sold), or
 *      "unresolved". `review` starts "pending".
 *   2. review — a person sets `review` to "approved" or "rejected". Only
 *      approved "replace" and "retire" entries are ever written.
 *   3. apply — dry run by default.
 *        pnpm exec tsx scripts/enrichment/products/curated-products/repair-dead-links.ts --manifest=<path>
 *        …--apply              write the approved entries
 *        …--target=production  defaults to staging; must match the manifest's target
 *
 * PRECONDITIONS, CHECKED FRESH AT APPLY: the row still exists and is visible,
 * and its `official_url` still equals the manifest's `oldUrl` — a curator who
 * already fixed it wins. A "replace" also re-probes `newUrl` and skips unless
 * it answers ok now.
 *
 * WRITES go through the curator service: `updateCuratedProduct(id,
 * { officialUrl })` or `retireCuratedProduct(id)`. `link_state` is never
 * written here (the checker owns it), so a replaced row keeps its suppressed
 * CTA until the next link check; run check-links.ts --apply afterwards to
 * restore it at once.
 *
 * ROLLBACK: every written entry carries its `oldUrl`, so a replace is undone
 * with `updateCuratedProduct(id, { officialUrl: oldUrl })` and a retire with
 * `updateCuratedProduct(id, { visible: true })`. The apply run prints each id.
 */

export type RepairProposal = "replace" | "retire" | "unresolved";

export type RepairEntry = {
  id: string;
  key: string;
  brandSlug: string | null;
  nameZh: string;
  oldUrl: string;
  proposal: RepairProposal;
  newUrl: string | null;
  evidence: string;
  /** Set by a person. Only "approved" is ever written. */
  review: "pending" | "approved" | "rejected";
};

export type RepairManifest = {
  ticket: "DEV-2043";
  target: ScriptTarget;
  generatedAt: string;
  entries: RepairEntry[];
};

export type CurrentRow = {
  id: string;
  visible: boolean;
  official_url: string | null;
};

export type SkipReason =
  | "not-approved"
  | "unresolved"
  | "no-new-url"
  | "row-missing"
  | "row-hidden"
  | "url-changed"
  | "new-url-not-ok";

export type RepairReport = {
  intended: number;
  written: number;
  writtenIds: string[];
  writtenBrandSlugs: string[];
  skipped: Record<SkipReason, number>;
  failures: string[];
};

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

/** The manifest-only checks: no database, no network. */
export function staticSkipReason(entry: RepairEntry): SkipReason | null {
  if (entry.review !== "approved") return "not-approved";
  if (entry.proposal === "unresolved") return "unresolved";
  if (entry.proposal === "replace" && (!entry.newUrl || !isHttpUrl(entry.newUrl))) {
    return "no-new-url";
  }
  return null;
}

/** The fresh-row checks: a curator edit since the manifest was written wins. */
export function rowSkipReason(
  entry: RepairEntry,
  row: CurrentRow | undefined,
): SkipReason | null {
  if (!row) return "row-missing";
  if (!row.visible) return "row-hidden";
  if (row.official_url !== entry.oldUrl) return "url-changed";
  return null;
}

/**
 * Sequential on purpose: two dozen single-row writes finish in seconds and
 * keep the audit trail in output order. A probe failure or write failure is
 * counted and carried, never thrown — one bad row must not end a run that has
 * already written an arbitrary prefix of the rest.
 */
export async function applyRepairs({
  entries,
  current,
  apply,
  probe,
  replaceUrl,
  retire,
}: {
  entries: readonly RepairEntry[];
  current: ReadonlyMap<string, CurrentRow>;
  apply: boolean;
  probe: (url: string) => Promise<CheckUrlResult>;
  replaceUrl: (id: string, url: string) => Promise<void>;
  retire: (id: string) => Promise<void>;
}): Promise<RepairReport> {
  const skipped: Record<SkipReason, number> = {
    "not-approved": 0,
    unresolved: 0,
    "no-new-url": 0,
    "row-missing": 0,
    "row-hidden": 0,
    "url-changed": 0,
    "new-url-not-ok": 0,
  };
  const ready: RepairEntry[] = [];
  for (const entry of entries) {
    const reason =
      staticSkipReason(entry) ?? rowSkipReason(entry, current.get(entry.id));
    if (reason) {
      skipped[reason] += 1;
      continue;
    }
    if (entry.proposal === "replace") {
      const result = await probe(entry.newUrl!);
      if (result.status !== "ok") {
        skipped["new-url-not-ok"] += 1;
        continue;
      }
    }
    ready.push(entry);
  }

  const report: RepairReport = {
    intended: ready.length,
    written: 0,
    writtenIds: [],
    writtenBrandSlugs: [],
    skipped,
    failures: [],
  };
  if (!apply) return report;

  const slugs = new Set<string>();
  for (const entry of ready) {
    try {
      if (entry.proposal === "replace") await replaceUrl(entry.id, entry.newUrl!);
      else await retire(entry.id);
      report.written += 1;
      report.writtenIds.push(entry.id);
      if (entry.brandSlug) slugs.add(entry.brandSlug);
    } catch (error: unknown) {
      report.failures.push(
        `${entry.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  report.writtenBrandSlugs = [...slugs].sort();
  return report;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function manifestPath(argv: readonly string[]): string {
  const inline = argv.find((arg) => arg.startsWith("--manifest="));
  const path = inline?.slice("--manifest=".length);
  if (!path) throw new Error("usage: repair-dead-links.ts --manifest=<path> [--apply]");
  return path;
}

function readManifest(path: string): RepairManifest {
  if (!existsSync(path)) throw new Error(`manifest not found: ${path}`);
  const manifest = JSON.parse(readFileSync(path, "utf8")) as RepairManifest;
  if (manifest.ticket !== "DEV-2043" || !Array.isArray(manifest.entries)) {
    throw new Error(`${path} is not a DEV-2043 repair manifest`);
  }
  return manifest;
}

async function main(): Promise<void> {
  const { target, argv } = loadScriptTarget();
  const path = manifestPath(argv);
  const apply = parseApplyOption(argv);
  const manifest = readManifest(path);
  if (manifest.target !== target) {
    throw new Error(
      `manifest was written against ${manifest.target}; refusing to apply it to ${target}`,
    );
  }
  // Staging has no revalidation route — see normalize-names.ts.
  const revalidate = target !== "staging";
  if (apply && revalidate) assertRevalidationConfigured();

  const { createServiceClient } = await import("@/lib/supabase/service");
  const supabase = createServiceClient();
  const ids = manifest.entries.map((entry) => entry.id);
  const rows = await fetchAllRows<CurrentRow>("curated_products", (from, to) =>
    supabase
      .from("curated_products")
      .select("id, visible, official_url")
      .in("id", ids)
      .order("id")
      .range(from, to),
  );
  const current = new Map(rows.map((row) => [row.id, row]));

  const { checkUrl } = await import("@/lib/services/link-checks/check-url");
  const { updateCuratedProduct, retireCuratedProduct } = await import(
    "@/lib/services/curated-products"
  );
  const report = await applyRepairs({
    entries: manifest.entries,
    current,
    apply,
    probe: (url) => checkUrl(url),
    replaceUrl: (id, url) => updateCuratedProduct(id, { officialUrl: url }),
    retire: (id) => retireCuratedProduct(id),
  });

  console.log(
    JSON.stringify({
      mode: apply ? "apply" : "dry-run",
      manifest: path,
      entries: manifest.entries.length,
      intended: report.intended,
      written: report.written,
      skipped: report.skipped,
      failures: report.failures.length,
    }),
  );
  for (const id of report.writtenIds) console.log(JSON.stringify({ written: id }));
  for (const failure of report.failures) console.log(JSON.stringify({ failed: failure }));
  if (report.failures.length > 0) process.exitCode = 1;

  if (!apply) {
    console.log("No changes made. Re-run with --apply to write.");
    return;
  }
  if (report.written === 0) return;
  if (!revalidate) {
    console.log(JSON.stringify(STAGING_REVALIDATION_SKIPPED));
    return;
  }
  const { requestPublicBrandRevalidation } = await import("@/lib/cache/revalidate-client");
  const revalidation = await requestPublicBrandRevalidation(report.writtenBrandSlugs);
  console.log(
    JSON.stringify({
      revalidated: report.writtenBrandSlugs.length,
      ok: revalidation.ok,
      reason: revalidation.reason ?? null,
    }),
  );
  if (!revalidation.ok) {
    throw new Error(
      `revalidation failed (${revalidation.reason ?? "unknown"}): brand pages are stale`,
    );
  }
}

// The test imports the pure functions, so importing must never start a run.
if (process.argv[1]?.endsWith("curated-products/repair-dead-links.ts")) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
