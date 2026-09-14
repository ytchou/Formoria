/**
 * @formoria-script
 * purpose: Parse and validate eval manifest JSONs (expected outcomes, tags, groups).
 * class: shared
 * invoke: pnpm exec tsx scripts/enrichment/eval/manifest.ts
 * target: none
 * safety: read-only
 * owner: engineering
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COHORT_ROOT = "scripts/curation-cohorts";

export const TAGS = [
  "own_site",
  "pinkoi",
  "shopee",
  "myship",
  "multi_channel",
  "marketplace_only",
  "custom_domain",
  "hosted_storefront",
  "www_non_www",
  "subdomain",
  "locale_path",
  "deep_category_path",
  "redirect",
  "js_render",
  "crawler_block",
  "single_listing",
  "no_catalog",
  "bad_source_url",
  "existing_products",
] as const;
export type Tag = (typeof TAGS)[number];

const TAG_SET = new Set<string>(TAGS);

export const EXPECTED = [
  "success_products",
  "correct_zero",
  "data_defect",
] as const;
export type Expected = (typeof EXPECTED)[number];

const EXPECTED_SET = new Set<string>(EXPECTED);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EvalEntry = {
  group: "opt10" | "opt20" | "holdout";
  tags: Tag[];
  expected: Expected | null;
  evidence: string | null;
};

export type EvalManifest = {
  name: string;
  title: string;
  subtitle: string;
  warning?: string;
  holdout?: boolean;
  labels: Record<string, string>;
  slugs: string[];
  eval: Record<string, EvalEntry>;
};

// ---------------------------------------------------------------------------
// Parsing + validation
// ---------------------------------------------------------------------------

function assertString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`manifest: ${field} must be a non-empty string`);
  }
  return value;
}

export function parseEvalManifest(raw: unknown): EvalManifest {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("manifest: expected a JSON object");
  }
  const obj = raw as Record<string, unknown>;

  const name = assertString(obj.name, "name");
  const title = assertString(obj.title, "title");
  const subtitle = assertString(obj.subtitle, "subtitle");

  const warning =
    typeof obj.warning === "string" ? obj.warning : undefined;
  const holdout =
    typeof obj.holdout === "boolean" ? obj.holdout : undefined;

  // labels
  if (typeof obj.labels !== "object" || obj.labels === null || Array.isArray(obj.labels)) {
    throw new Error("manifest: labels must be a Record<string, string>");
  }
  const labels = obj.labels as Record<string, string>;
  const slugs = Object.keys(labels);
  if (slugs.length === 0) {
    throw new Error("manifest: labels must not be empty");
  }

  // eval block
  if (typeof obj.eval !== "object" || obj.eval === null || Array.isArray(obj.eval)) {
    throw new Error("manifest: eval must be a Record<string, EvalEntry>");
  }
  const rawEval = obj.eval as Record<string, unknown>;

  // Bi-directional key check: eval keys === labels keys
  const labelKeys = new Set(slugs);
  const evalKeys = new Set(Object.keys(rawEval));

  for (const key of labelKeys) {
    if (!evalKeys.has(key)) {
      throw new Error(`manifest: slug "${key}" in labels but missing from eval`);
    }
  }
  for (const key of evalKeys) {
    if (!labelKeys.has(key)) {
      throw new Error(`manifest: slug "${key}" in eval but missing from labels`);
    }
  }

  // Parse each eval entry
  const evalMap: Record<string, EvalEntry> = {};

  for (const [slug, entryRaw] of Object.entries(rawEval)) {
    if (typeof entryRaw !== "object" || entryRaw === null || Array.isArray(entryRaw)) {
      throw new Error(`manifest: eval["${slug}"] must be an object`);
    }
    const entry = entryRaw as Record<string, unknown>;

    // group
    const group = entry.group;
    if (group !== "opt10" && group !== "opt20" && group !== "holdout") {
      throw new Error(
        `manifest: eval["${slug}"].group must be opt10, opt20, or holdout; got "${String(group)}"`,
      );
    }

    // tags
    if (!Array.isArray(entry.tags)) {
      throw new Error(`manifest: eval["${slug}"].tags must be an array`);
    }
    const tags: Tag[] = [];
    for (const tag of entry.tags) {
      if (typeof tag !== "string" || !TAG_SET.has(tag)) {
        throw new Error(
          `manifest: eval["${slug}"].tags contains invalid tag "${String(tag)}"`,
        );
      }
      tags.push(tag as Tag);
    }

    // expected
    const expected = entry.expected;
    if (expected !== null) {
      if (typeof expected !== "string" || !EXPECTED_SET.has(expected)) {
        throw new Error(
          `manifest: eval["${slug}"].expected must be one of ${EXPECTED.join(", ")} or null; got "${String(expected)}"`,
        );
      }
    }

    // evidence — required when expected is set
    const evidence =
      typeof entry.evidence === "string" ? entry.evidence : null;
    if (expected !== null && evidence === null) {
      throw new Error(
        `manifest: eval["${slug}"].evidence is required when expected is set`,
      );
    }

    evalMap[slug] = {
      group,
      tags,
      expected: expected as Expected | null,
      evidence,
    };
  }

  return {
    name,
    title,
    subtitle,
    ...(warning !== undefined ? { warning } : {}),
    ...(holdout !== undefined ? { holdout } : {}),
    labels,
    slugs,
    eval: evalMap,
  };
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

export function selectSlugs(
  manifest: EvalManifest,
  opts: { slugs?: string[]; tags?: Tag[] },
): string[] {
  const allSlugs = new Set(manifest.slugs);

  // Validate requested slugs
  if (opts.slugs) {
    for (const s of opts.slugs) {
      if (!allSlugs.has(s)) {
        throw new Error(`selectSlugs: unknown slug "${s}"`);
      }
    }
  }

  if (opts.slugs && opts.tags) {
    // Intersection: slugs that have any of the tags
    const tagSet = new Set<string>(opts.tags);
    return opts.slugs.filter((slug) => {
      const entry = manifest.eval[slug];
      return entry.tags.some((t) => tagSet.has(t));
    });
  }

  if (opts.slugs) {
    return opts.slugs;
  }

  if (opts.tags) {
    const tagSet = new Set<string>(opts.tags);
    return manifest.slugs.filter((slug) => {
      const entry = manifest.eval[slug];
      return entry.tags.some((t) => tagSet.has(t));
    });
  }

  // Neither: all slugs
  return [...manifest.slugs];
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export async function loadEvalManifest(ref: string): Promise<EvalManifest> {
  const path = ref.includes("/")
    ? resolve(ref)
    : resolve(COHORT_ROOT, `${ref}.json`);

  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    throw new Error(`eval manifest not found: ${path}`);
  }

  return parseEvalManifest(JSON.parse(raw));
}
