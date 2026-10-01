/**
 * Applies a founder-reviewed picks.json to one discovery trail (DEV-1903).
 *
 *   npx tsx scripts/trails/apply-picks.ts --trail <slug> --picks <file> [--target staging|production] [--dry-run] [--mdx-only] [--skip-revalidate]
 *
 * Registry: scripts/trails/ registers one entry file (shortlist.ts); this is
 * its sibling. purpose: writes trail placements, or the MDX notes with
 * --mdx-only. safety: writes (dry run with --dry-run). target: staging-default.
 *
 * MODES
 *   default       Retires every active placement the picks do not name, then
 *                 upserts each pick at its position in its section. Writes go
 *                 through upsertCuratedProductSelection /
 *                 retireCuratedProductSelection only. Revalidates the trail
 *                 (and the touched brands) afterwards; a failed revalidation
 *                 exits non-zero.
 *   --dry-run     Reads and prints the plan. Zero writes.
 *   --mdx-only    Validates the picks, resolves every key against the target
 *                 (read-only), then rewrites only the `notes` blocks in
 *                 content/trails/<slug>.mdx. Zero placement writes, no
 *                 revalidation. Combine with --dry-run to print the result.
 *   --skip-revalidate
 *                 Production only, for the pre-promotion apply (D11).
 *
 * Run from the worktree that holds the target MDX: validateSelectionInput
 * reads content/trails/ relative to the current directory.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { requestPublicBrandRevalidation } from "@/lib/cache/revalidate-client";
import {
  retireCuratedProductSelection,
  upsertCuratedProductSelection,
} from "@/lib/services/curated-products";
import { getTrailBySlug } from "@/lib/services/trails";
import { createServiceClient } from "@/lib/supabase/service";

import { loadScriptTarget, type ScriptTarget } from "../shared/target";
import {
  isTrailEligibleProduct,
  notesForSection,
  planPlacements,
  rewriteTrailNotes,
  TRAIL_ELIGIBILITY_SELECT,
  validatePicks,
  type CurrentPlacement,
  type ResolvedPick,
  type TrailEligibilityRow,
} from "./lib";

type Options = {
  trail: string;
  picks: string;
  dryRun: boolean;
  mdxOnly: boolean;
  skipRevalidate: boolean;
};

const BOOLEAN_FLAGS = new Set(["--dry-run", "--mdx-only", "--skip-revalidate"]);

function parseOptions(argv: readonly string[], target: ScriptTarget): Options {
  let trail: string | undefined;
  let picks: string | undefined;
  const flags = new Set<string>();

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (BOOLEAN_FLAGS.has(argument)) {
      flags.add(argument);
      continue;
    }
    const [flag, inline] = argument.includes("=")
      ? [argument.slice(0, argument.indexOf("=")), argument.slice(argument.indexOf("=") + 1)]
      : [argument, undefined];
    const value = inline ?? argv[index + 1];
    if (inline === undefined && (flag === "--trail" || flag === "--picks")) index += 1;

    if (flag === "--trail") trail = value;
    else if (flag === "--picks") picks = value;
    else throw new Error(`Unknown argument ${argument}`);
  }

  if (!trail?.trim()) throw new Error("--trail <slug> is required");
  if (!picks?.trim()) throw new Error("--picks <file> is required");

  const skipRevalidate = flags.has("--skip-revalidate");
  if (skipRevalidate && target !== "production") {
    throw new Error(
      "--skip-revalidate is allowed only with --target production (the pre-promotion apply)",
    );
  }

  return {
    trail: trail.trim(),
    picks: path.resolve(picks.trim()),
    dryRun: flags.has("--dry-run"),
    mdxOnly: flags.has("--mdx-only"),
    skipRevalidate,
  };
}

/**
 * Mirrors assertRevalidationConfigured in
 * scripts/enrichment/products/curated-products/shared.ts; restated so the
 * message names this script's flags instead of --apply.
 */
function assertRevalidationConfigured(): void {
  const hasOrigin = Boolean(
    process.env.FORMORIA_RAILWAY_URL?.trim() ||
      process.env.NEXT_PUBLIC_SITE_URL?.trim(),
  );
  const hasSecret = Boolean(process.env.ORIGIN_SECRET?.trim());
  if (hasOrigin && hasSecret) return;
  throw new Error(
    "apply-picks requires ORIGIN_SECRET and FORMORIA_RAILWAY_URL (or NEXT_PUBLIC_SITE_URL) before any write: " +
      "without them the placements land but the trail page keeps serving the stale ISR shell",
  );
}

type ProductRow = TrailEligibilityRow & {
  id: string;
  key: string;
  brands: { slug: string; status: string | null } | null;
};

/** Resolves every `(brandSlug, productKey)` to a product id; refuses ineligible ones. */
async function resolvePicks(
  sections: Record<string, { brandSlug: string; productKey: string; note: string }[]>,
): Promise<Record<string, ResolvedPick[]>> {
  const all = Object.values(sections).flat();
  if (all.length === 0) return Object.fromEntries(Object.keys(sections).map((key) => [key, []]));

  const { data, error } = await createServiceClient()
    .from("curated_products")
    .select(TRAIL_ELIGIBILITY_SELECT)
    .in("key", [...new Set(all.map((pick) => pick.productKey))])
    .in("brands.slug", [...new Set(all.map((pick) => pick.brandSlug))]);
  if (error) throw new Error(`Product key resolution failed: ${error.message}`);

  // (brand_id, key) is unique, so a brand slug and key name at most one row.
  const byPair = new Map(
    ((data ?? []) as unknown as ProductRow[]).map((row) => [
      `${row.brands?.slug}/${row.key}`,
      row,
    ]),
  );

  const problems: string[] = [];
  const resolved = Object.fromEntries(
    Object.entries(sections).map(([sectionKey, picks]) => [
      sectionKey,
      picks.flatMap((pick) => {
        const pair = `${pick.brandSlug}/${pick.productKey}`;
        const row = byPair.get(pair);
        if (!row) {
          problems.push(`${sectionKey}: ${pair} not found on this target`);
          return [];
        }
        if (!isTrailEligibleProduct(row)) {
          problems.push(`${sectionKey}: ${pair} is not trail-eligible`);
          return [];
        }
        return [{ ...pick, productId: row.id }];
      }),
    ]),
  );

  if (problems.length > 0) {
    throw new Error(`Picks do not resolve:\n- ${problems.join("\n- ")}`);
  }
  return resolved;
}

type CurrentRow = {
  product_id: string;
  section_key: string;
  position: number | null;
  curated_products: { key: string; brands: { slug: string } | null } | null;
};

async function readActivePlacements(
  trailSlug: string,
): Promise<{ placements: CurrentPlacement[]; brandOf: Map<string, string> }> {
  const { data, error } = await createServiceClient()
    .from("curated_product_selections")
    .select("product_id, section_key, position, curated_products!inner(key, brands!inner(slug))")
    .eq("trail_slug", trailSlug)
    .eq("state", "active");
  if (error) throw new Error(`Active placement read failed: ${error.message}`);

  const rows = (data ?? []) as unknown as CurrentRow[];
  const brandOf = new Map<string, string>();
  for (const row of rows) {
    const slug = row.curated_products?.brands?.slug;
    if (slug) brandOf.set(row.product_id, slug);
  }
  return {
    placements: rows.map((row) => ({
      productId: row.product_id,
      sectionKey: row.section_key,
      position: row.position ?? 0,
    })),
    brandOf,
  };
}

export async function main(argv: readonly string[] = process.argv.slice(2)) {
  const { target, projectRef, argv: rest } = loadScriptTarget(argv);
  console.log(`[apply-picks] target ${target} — project ref ${projectRef}`);
  const options = parseOptions(rest, target);

  const mdxPath = path.join(process.cwd(), "content", "trails", `${options.trail}.mdx`);
  console.warn(
    `[apply-picks] run from the worktree holding the target MDX: placement validation reads ${mdxPath}`,
  );
  if (options.skipRevalidate) {
    console.warn(
      "[apply-picks] --skip-revalidate: safe only for the pre-promotion production apply — production still runs the old revalidate route and the new trail pages do not exist yet; the promotion deploy builds them from these placements",
    );
  }

  const trail = await getTrailBySlug(options.trail);
  if (!trail) throw new Error(`No trail MDX at ${mdxPath}`);
  const sectionKeys = trail.entry.frontmatter.sections.map((section) => section.key);

  const picks = validatePicks(JSON.parse(await readFile(options.picks, "utf8")), sectionKeys);
  if (picks.trail !== options.trail) {
    throw new Error(`Picks trail "${picks.trail}" does not match --trail ${options.trail}`);
  }

  const resolved = await resolvePicks(picks.sections);
  console.log(
    `[apply-picks] ${Object.values(resolved).flat().length} picks resolved and eligible`,
  );

  if (options.mdxOnly) {
    // Picks are the whole desired state: a section with no picks loses its notes.
    const notesBySection = Object.fromEntries(
      sectionKeys.map((key) => [key, notesForSection(picks.sections[key] ?? [])]),
    );
    const source = await readFile(mdxPath, "utf8");
    const rewritten = rewriteTrailNotes(source, notesBySection);
    if (options.dryRun) {
      console.log(`[apply-picks] --dry-run: ${mdxPath} would become:\n${rewritten}`);
      return;
    }
    if (rewritten === source) {
      console.log(`[apply-picks] ${mdxPath} notes already match`);
      return;
    }
    await writeFile(mdxPath, rewritten, "utf8");
    console.log(`[apply-picks] rewrote notes in ${mdxPath}; no placements written`);
    return;
  }

  const { placements, brandOf } = await readActivePlacements(options.trail);
  const plan = planPlacements(placements, resolved);
  for (const row of plan.retire) {
    console.log(`[apply-picks] retire ${row.sectionKey}: ${brandOf.get(row.productId) ?? "?"} ${row.productId}`);
  }
  for (const row of plan.upsert) {
    console.log(
      `[apply-picks] upsert ${row.sectionKey}#${row.position}: ${row.brandSlug}/${row.productKey}`,
    );
  }

  if (options.dryRun) {
    console.log(`[apply-picks] --dry-run: no writes (project ref ${projectRef})`);
    return;
  }

  if (!options.skipRevalidate) assertRevalidationConfigured();

  const touchedBrands = new Set<string>();
  let writes = 0;
  try {
    // Retires first — see planPlacements.
    for (const row of plan.retire) {
      await retireCuratedProductSelection({ ...row, trailSlug: options.trail });
      writes += 1;
      const slug = brandOf.get(row.productId);
      if (slug) touchedBrands.add(slug);
    }
    for (const row of plan.upsert) {
      await upsertCuratedProductSelection({
        productId: row.productId,
        trailSlug: options.trail,
        sectionKey: row.sectionKey,
        position: row.position,
      });
      writes += 1;
      touchedBrands.add(row.brandSlug);
    }
  } finally {
    // A write that failed midway still leaves earlier writes committed, so
    // revalidate whatever landed before the error propagates.
    if (writes > 0 && !options.skipRevalidate) {
      const revalidation = await requestPublicBrandRevalidation([...touchedBrands], {
        trailSlugs: [options.trail],
      });
      console.log(
        JSON.stringify({
          writes,
          revalidatedBrands: touchedBrands.size,
          trail: options.trail,
          ok: revalidation.ok,
          reason: revalidation.reason ?? null,
        }),
      );
      if (!revalidation.ok) {
        // The placements are committed and cannot be undone here, but the run
        // must never exit 0 while the trail page serves the old picks.
        process.exitCode = 1;
        console.error(
          `[apply-picks] revalidation failed (${revalidation.reason ?? "unknown"}): trail pages are stale`,
        );
      }
    }
  }

  console.log(`[apply-picks] applied ${writes} placement writes to ${options.trail}`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
