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
    const { getLangfuse } = await import("@/lib/langfuse/client");
    const { auditedCall } = await import("@/lib/audit");
    const { createOpenAIClient } = await import(
      "@/lib/services/openai-client"
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
      fetchPrompt: async () => {
        // products-describe is a Langfuse-only prompt (not in the local snapshot).
        // fetchLangfusePromptWithMeta requires a snapshot entry; fetch directly instead.
        const client = getLangfuse();
        if (!client) {
          throw new Error(
            "Langfuse client not configured — products-describe prompt requires LANGFUSE_SECRET_KEY",
          );
        }
        const promptClient = await client.getPrompt(
          "products-describe",
          undefined,
          { label: "production" },
        );
        if (typeof promptClient.prompt !== "string") {
          throw new Error("products-describe prompt is not a text prompt");
        }
        return {
          text: promptClient.prompt,
          prompt: {
            name: promptClient.name,
            version: promptClient.version,
            source: "langfuse" as const,
          },
        };
      },
      callLlm: async (system, user) => {
        return auditedCall(
          {
            provider: "openai",
            operation: "chat_completions",
            kind: "external",
          },
          async (ctx) => {
            const client = createOpenAIClient({ model: "gpt-4.1-mini" });
            const result = await client.chat({
              system,
              user,
              temperature: 0.3,
              timeoutMs: 90_000,
            });
            if (!result.ok) {
              throw new Error(
                `LLM call failed: ${result.status} ${result.finishReason ?? "unknown"}`,
              );
            }
            ctx.promptTokens =
              result.data?.usage?.prompt_tokens ?? null;
            ctx.completionTokens =
              result.data?.usage?.completion_tokens ?? null;
            return { text: result.content ?? "" };
          },
        );
      },
      verifyDescription,
      updateProduct: async (id, input) => {
        await updateCuratedProduct(id, input);
      },
    };

    if (!apply) {
      const { setAuditWriteSeam } = await import("@/lib/audit/emit");
      setAuditWriteSeam(async () => null);
    }
    const since = new Date();

    const result = await rewriteGeneratedDescriptions(deps, {
      apply,
      brandSlug,
    });

    if (!apply) {
      console.log(JSON.stringify(result.diffs, null, 2));
      console.log(
        `\nDry-run complete. Total: ${result.total}, Would rewrite: ${result.rewritten}, Skipped: ${result.skipped.length}, Failed: ${result.failed.length}`,
      );
      const { assertNoNewAuditRows } = await import(
        "@/lib/services/eval/zero-write"
      );
      await assertNoNewAuditRows({ since });
    } else {
      console.log(
        `Rewritten: ${result.rewritten}/${result.total}, Skipped: ${result.skipped.length}, Failed: ${result.failed.length}`,
      );
      console.log(
        "Run pnpm embeddings:backfill --apply to refresh vector embeddings.",
      );
    }

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
