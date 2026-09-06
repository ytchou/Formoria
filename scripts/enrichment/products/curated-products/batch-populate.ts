/**
 * Batch-populate curated products for a set of brands (DEV-1609).
 *
 *   pnpm exec tsx --env-file=.env.local scripts/curated-products/batch-populate.ts --slugs brand-a,brand-b
 *   pnpm exec tsx --env-file=.env.local scripts/curated-products/batch-populate.ts --csv brands.csv
 *   …--apply    actually runs the backfill; without it the script resolves brands and stops.
 *
 * CSV format: first row is a header containing a `formoria_slug` column;
 * remaining rows are comma-separated values.
 *
 * Dry-run by default: resolves brand slugs to IDs and reports what it WOULD do.
 * `--apply` resolves the admin requester and calls `requestCuratedProductBackfill`.
 */

import { readFileSync } from "node:fs";

import { createServiceClient } from "@/lib/supabase/service";
import {
  requestCuratedProductBackfill,
  type CuratedProductBackfillResult,
} from "@/lib/services/curated-products/backfill";

import { parseApplyOption, parseCsvPath, parseSlugsOption } from "./shared";

// ---------------------------------------------------------------------------
// Injectable deps
// ---------------------------------------------------------------------------

export type BatchPopulateDeps = {
  resolveBrands: (
    slugs: string[],
  ) => Promise<
    Array<{ id: string; slug: string; purchase_website: string | null }>
  >;
  resolveRequester: (
    email: string,
  ) => Promise<{ id: string; email: string }>;
  runBackfill: (
    brandIds: string[],
    requester: { id: string; email: string },
  ) => Promise<CuratedProductBackfillResult>;
};

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export type BatchPopulateInput = {
  slugs: string[];
  apply: boolean;
  adminEmail: string;
};

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

type BackfillOutcome = {
  brandId: string;
  submissionId: string | null;
  error: string | null;
};

export type BatchPopulateResult = {
  mode: "dry-run" | "apply";
  brands: Array<{ id: string; slug: string }>;
  jobId: string | null;
  outcomes: BackfillOutcome[];
};

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

export async function batchPopulate(
  input: BatchPopulateInput,
  deps: BatchPopulateDeps,
): Promise<BatchPopulateResult> {
  const { slugs, apply, adminEmail } = input;

  // 1. Resolve slugs to brand rows
  const brands = await deps.resolveBrands(slugs);

  // Abort on unresolved slugs
  const resolvedSlugs = new Set(brands.map((b) => b.slug));
  const missing = slugs.filter((s) => !resolvedSlugs.has(s));
  if (missing.length > 0) {
    throw new Error(`Unresolved brand slugs: ${missing.join(", ")}`);
  }

  // Abort on missing purchase_website
  const noPurchaseWebsite = brands.filter((b) => !b.purchase_website);
  if (noPurchaseWebsite.length > 0) {
    throw new Error(
      `Brands without purchase_website: ${noPurchaseWebsite.map((b) => b.slug).join(", ")}`,
    );
  }

  // 2. Dry-run: report resolved brands but don't call backfill
  if (!apply) {
    return {
      mode: "dry-run",
      brands: brands.map(({ id, slug }) => ({ id, slug })),
      jobId: null,
      outcomes: [],
    };
  }

  // 3. Resolve the admin requester
  const requester = await deps.resolveRequester(adminEmail);

  // 4. Run the backfill
  const brandIds = brands.map((b) => b.id);
  const result = await deps.runBackfill(brandIds, requester);

  return {
    mode: "apply",
    brands: brands.map(({ id, slug }) => ({ id, slug })),
    jobId: result.jobId,
    outcomes: result.outcomes,
  };
}

// ---------------------------------------------------------------------------
// Production deps
// ---------------------------------------------------------------------------

function productionDeps(): BatchPopulateDeps {
  return {
    resolveBrands: async (slugs) => {
      const supabase = createServiceClient();
      const { data, error } = await supabase
        .from("brands")
        .select("id, slug, purchase_website")
        .in("slug", slugs);
      if (error) throw new Error(`Failed to resolve brands: ${error.message}`);
      return (data ?? []) as Array<{
        id: string;
        slug: string;
        purchase_website: string | null;
      }>;
    },
    resolveRequester: async (email) => {
      const supabase = createServiceClient();
      for (let page = 1; ; page += 1) {
        const { data, error } = await supabase.auth.admin.listUsers({
          page,
          perPage: 1_000,
        });
        if (error) throw error;
        const match = data.users.find(
          (user) => user.email?.toLowerCase() === email.toLowerCase(),
        );
        if (match) return { id: match.id, email };
        if (data.users.length < 1_000) break;
      }
      throw new Error(`Admin user not found: ${email}`);
    },
    runBackfill: requestCuratedProductBackfill,
  };
}

// ---------------------------------------------------------------------------
// CSV reader
// ---------------------------------------------------------------------------

function readSlugsFromCsv(csvPath: string): string[] {
  const content = readFileSync(csvPath, "utf-8");
  const lines = content.split("\n").filter((line) => line.trim());
  if (lines.length < 2) throw new Error("CSV file must have a header and at least one row");

  const headers = lines[0]!.split(",").map((h) => h.trim());
  const slugIndex = headers.indexOf("formoria_slug");
  if (slugIndex === -1) {
    throw new Error('CSV must contain a "formoria_slug" column');
  }

  const slugs: string[] = [];
  for (let i = 1; i < lines.length; i++) {
    const columns = lines[i]!.split(",");
    const slug = columns[slugIndex]?.trim();
    if (slug) slugs.push(slug);
  }

  if (slugs.length === 0) throw new Error("No slugs found in CSV");
  return slugs;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const apply = parseApplyOption(argv);

  const csvPath = parseCsvPath(argv);
  const slugsArg = parseSlugsOption(argv);

  if (csvPath && slugsArg) {
    throw new Error("Provide --csv or --slugs, not both");
  }
  if (!csvPath && !slugsArg) {
    throw new Error("Provide --csv <path> or --slugs <slug1,slug2,...>");
  }

  const slugs = csvPath ? readSlugsFromCsv(csvPath) : slugsArg!;

  const adminEmail = process.env.ADMIN_EMAILS?.split(",")
    .map((v) => v.trim())
    .find(Boolean);
  if (!adminEmail) throw new Error("ADMIN_EMAILS must contain an admin account");

  const result = await batchPopulate(
    { slugs, apply, adminEmail },
    productionDeps(),
  );

  console.log(JSON.stringify(result, null, 2));

  if (!apply) {
    console.log("No changes made. Re-run with --apply to write.");
  }
}

if (process.argv[1]?.endsWith("curated-products/batch-populate.ts")) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
