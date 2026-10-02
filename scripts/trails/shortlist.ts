/**
 * @formoria-script
 * purpose: Builds a per-section candidate shortlist for one discovery trail and writes a local HTML review sheet plus candidates.json.
 * class: operator
 * invoke: npx tsx scripts/trails/shortlist.ts --trail <slug> --out <dir> [--target staging|production]
 * target: staging-default
 * safety: read-only
 * owner: engineering
 * notes: Reads scripts/trails/briefs/<slug>.json. Ranking is the retrieval (RRF) position only; LTR is forced off. Writes only under --out. Sibling scripts/trails/apply-picks.ts applies the reviewed picks.json (writes placements, or MDX notes with --mdx-only; --dry-run supported).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { createServiceClient } from "@/lib/supabase/service";

import { loadScriptTarget } from "../shared/target";
import {
  dedupeByBrandPerSection,
  isTrailEligibleProduct,
  parseTrailBrief,
  parseTrailSlugOption,
  TRAIL_ELIGIBILITY_SELECT,
  type ShortlistCandidate,
  type ShortlistCandidates,
  type ShortlistSection,
  type TrailEligibilityRow,
} from "./lib";
import { renderReviewSheet } from "./review-sheet";

const RETRIEVAL_PAGE_SIZE = 30;
const CANDIDATES_PER_SECTION = 10;
const BRIEFS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "briefs",
);

type Options = { trail: string; out: string };

/** `argv` arrives with `--target` already stripped by loadScriptTarget. */
function parseOptions(argv: readonly string[]): Options {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      trail: { type: "string" },
      out: { type: "string" },
    },
    strict: true,
  });

  // Validated before it is joined into the brief path.
  const trail = parseTrailSlugOption(values.trail);
  const out = values.out?.trim();
  if (!out) throw new Error("--out <dir> is required");
  return { trail, out: path.resolve(out) };
}

type EligibilityRow = TrailEligibilityRow & { id: string };

async function readEligibility(
  productIds: readonly string[],
): Promise<Map<string, EligibilityRow>> {
  if (productIds.length === 0) return new Map();
  const { data, error } = await createServiceClient()
    .from("curated_products")
    .select(TRAIL_ELIGIBILITY_SELECT)
    .in("id", [...productIds]);
  if (error) throw new Error(`Eligibility read failed: ${error.message}`);
  const rows = (data ?? []) as unknown as EligibilityRow[];
  return new Map(rows.map((row) => [row.id, row]));
}

export async function main(argv: readonly string[] = process.argv.slice(2)) {
  const { target, projectRef, argv: rest } = loadScriptTarget(argv);
  const options = parseOptions(rest);
  console.log(`[shortlist] target ${target} — project ref ${projectRef}`);

  const brief = parseTrailBrief(
    JSON.parse(
      await readFile(path.join(BRIEFS_DIR, `${options.trail}.json`), "utf8"),
    ),
  );
  if (brief.slug !== options.trail) {
    throw new Error(`Brief slug "${brief.slug}" does not match --trail ${options.trail}`);
  }

  // LTR must never order the shortlist: the rank is the retrieval (RRF)
  // position alone. The service reads this at call time, and it is set after
  // loadScriptTarget so an env-file value cannot switch LTR back on. The
  // import is dynamic so nothing from the service runs before this line.
  process.env.SEARCH_LTR_MODE = "off";
  if (process.env.SEARCH_LTR_MODE !== "off") {
    throw new Error("SEARCH_LTR_MODE must be off for a shortlist run");
  }
  const { searchProductsBySituation } = await import(
    "@/lib/services/product-situation-search"
  );

  const sections: ShortlistSection[] = [];
  for (const section of brief.sections) {
    const result = await searchProductsBySituation({
      query: section.query,
      locale: "zh-TW",
      mode: "hybrid",
      subcategories: section.subcategories,
      pageSize: RETRIEVAL_PAGE_SIZE,
    });
    if (result.degraded) {
      console.warn(
        `[shortlist] ${section.key}: retrieval degraded (${result.degradedReason ?? "unknown"}); ranking is ${result.searchSource} only`,
      );
    }

    const eligibility = await readEligibility(
      result.products.map((product) => product.id),
    );
    const ranked: ShortlistCandidate[] = result.products.flatMap(
      (product, index) => {
        const row = eligibility.get(product.id);
        if (!row || !isTrailEligibleProduct(row)) return [];
        return [
          {
            sectionKey: section.key,
            rank: index + 1,
            productId: product.id,
            productKey: product.key,
            brandSlug: product.brandSlug,
            brandName: product.brandName,
            name: product.nameZh,
            subcategory: product.subcategory,
            imageUrl: product.imageUrl,
            officialUrl: product.officialUrl,
          },
        ];
      },
    );

    const candidates = dedupeByBrandPerSection(ranked).slice(
      0,
      CANDIDATES_PER_SECTION,
    );
    sections.push({ ...section, candidates });
    console.log(
      `[shortlist] ${section.key}: ${result.products.length} retrieved, ${ranked.length} eligible, ${candidates.length} brand-distinct kept`,
    );
    if (candidates.length < 3) {
      console.warn(
        `[shortlist] ${section.key}: fewer than 3 brands — reshape this section, never pad it`,
      );
    }
  }

  const shortlist: ShortlistCandidates = {
    trail: brief.slug,
    target,
    projectRef,
    generatedAt: new Date().toISOString(),
    sections,
  };

  await mkdir(options.out, { recursive: true });
  const htmlPath = path.join(options.out, `${brief.slug}.html`);
  const jsonPath = path.join(options.out, `${brief.slug}.candidates.json`);
  await writeFile(htmlPath, renderReviewSheet(shortlist), "utf8");
  await writeFile(jsonPath, `${JSON.stringify(shortlist, null, 2)}\n`, "utf8");
  console.log(`[shortlist] wrote ${htmlPath}`);
  console.log(`[shortlist] wrote ${jsonPath}`);
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
