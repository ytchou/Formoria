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
import type { RewriteDescriptionsResult } from "@/lib/services/curated-products/materialize";

import {
  parseApplyOption,
  parseBrandOption,
  parseCsvPath,
  parseRewriteOption,
  parseSlugsOption,
  fetchAllRows,
} from "./shared";

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
// Rewrite summary (DEV-1709, DEV-1856)
// ---------------------------------------------------------------------------

/** Summary lines for `--rewrite-descriptions`, apply or dry-run. */
export function rewriteSummaryLines(
  result: RewriteDescriptionsResult,
  apply: boolean,
): string[] {
  const counts = `Skipped: ${result.skipped.length}, Failed: ${result.failed.length}, Origin omitted: ${result.originOmitted.length}`;
  return [
    apply
      ? `Rewritten: ${result.rewritten}/${result.total}, ${counts}`
      : `Dry-run complete. Total: ${result.total}, Would rewrite: ${result.rewritten}, ${counts}`,
    ...result.originOmitted.map(
      (p) => `  origin omitted: ${p.brandSlug}/${p.nameZh} (${p.id})`,
    ),
    ...result.skipped.map(
      (p) => `  skipped: ${p.brandSlug}/${p.nameZh} (${p.id}): ${p.reason}`,
    ),
  ];
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

  // --rewrite-descriptions mode (DEV-1709)
  if (parseRewriteOption(argv)) {
    const { loadScriptTarget } = await import("../../../shared/target");
    loadScriptTarget();

    const brandSlug = parseBrandOption(argv) ?? undefined;

    const materializeMod = await import(
      "@/lib/services/curated-products/materialize"
    );
    const { rewriteGeneratedDescriptions } = materializeMod;

    const { createServiceClient } = await import("@/lib/supabase/service");
    const { readProductPage } = await import(
      "@/lib/services/enrich-phases/products/read-page"
    );
    const { fetchHtmlWithMetadata } = await import(
      "@/lib/services/enrich-phases/scraper/fetch-guards"
    );
    const { createProfiledOpenAIClient } = await import(
      "@/lib/services/llm-audit"
    );
    const { verifyDescription } = await import(
      "@/lib/services/enrich-phases/products/verify"
    );
    const { updateCuratedProduct } = await import(
      "@/lib/services/curated-products"
    );

    const deps: Parameters<typeof rewriteGeneratedDescriptions>[0] = {
      fetchGeneratedProducts: async (slug) => {
        const supabase = createServiceClient();
        return fetchAllRows("curated_products (generated)", (from, to) => {
          let query = supabase
            .from("curated_products")
            .select(
              "id, name_zh, official_url, category, subcategory, product_description_zh, brands!inner(slug, name)",
            )
            .eq("proposed_by", "generated")
            .order("brand_id")
            .order("name_zh")
            .range(from, to);
          if (slug) {
            query = query.eq("brands.slug", slug);
          }
          return query;
        }).then((rows) =>
          (rows as Array<Record<string, unknown>>).map((row) => {
            const brand = row.brands as { slug: string; name: string };
            return {
              id: row.id as string,
              nameZh: row.name_zh as string,
              officialUrl: (row.official_url as string) ?? null,
              category: row.category as string,
              subcategory: (row.subcategory as string) ?? null,
              productDescriptionZh: row.product_description_zh as string,
              brandSlug: brand.slug,
              brandName: brand.name,
            };
          }),
        );
      },
      readPage: async (url) => {
        return readProductPage(url, {
          fetchHtml: async (u) => {
            const result = await fetchHtmlWithMetadata(u);
            return {
              text: result.text ?? "",
              statusCode: result.status ?? 0,
            };
          },
          budget: {
            allowed: { reads: 1000, renders: 0, turns: 0, wallClockMs: 0 },
            used: { reads: 0, renders: 0, turns: 0, wallClockMs: 0 },
          },
        });
      },
      callLlm: async (system, user, prompt) => {
        const llmClient = createProfiledOpenAIClient("productDescriptions", {
          phase: "product_descriptions",
          prompt,
        });
        const result = await llmClient.chat({ system, user });
        if (!result.ok) {
          throw new Error(
            `LLM call failed: ${result.status} ${result.finishReason ?? "unknown"}`,
          );
        }
        return { text: result.content ?? "" };
      },
      verifyDescription,
      updateProduct: async (id, input) => {
        await updateCuratedProduct(id, input);
      },
    };

    if (!apply) {
      console.log(
        "Note: dry-run reads pages and calls the LLM to preview results. Use --brand <slug> to limit scope.",
      );
      const { installSeams, assertNoNewAuditRows } = await import(
        "@/lib/services/eval/zero-write"
      );
      const { runWithAuditContext } = await import("@/lib/audit/context");
      const { randomUUID } = await import("node:crypto");
      const runCorrelationId = randomUUID();
      const { collector, restore } = installSeams({
        sinkPath: "scripts/enrichment/products/curated-products/dry-run-sink.jsonl",
      });
      const since = new Date();
      try {
        const result = await runWithAuditContext(
          { correlationId: runCorrelationId },
          () => rewriteGeneratedDescriptions(deps, { apply, brandSlug }),
        );
        console.log(JSON.stringify(result.diffs, null, 2));
        console.log(`\n${rewriteSummaryLines(result, false).join("\n")}`);
        await assertNoNewAuditRows({
          since,
          correlationIds: [runCorrelationId],
          spanIds: collector.all().map((r) => r.spanId),
        });
        if (result.failed.length > 0) {
          process.exitCode = 1;
        }
      } finally {
        restore();
      }
      return;
    }
    const result = await rewriteGeneratedDescriptions(deps, {
      apply,
      brandSlug,
    });

    console.log(rewriteSummaryLines(result, true).join("\n"));
    console.log(
      "Run pnpm embeddings:backfill --apply to refresh vector embeddings.",
    );

    if (result.failed.length > 0) {
      process.exitCode = 1;
    }
    return;
  }

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
