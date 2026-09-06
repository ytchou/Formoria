import { execSync } from "node:child_process";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import snapshot from "@/lib/prompts/langfuse-snapshot.json";
import {
  CATEGORY_LIST,
  SUBCATEGORY_VOCAB_BLOCK,
  MATERIAL_VOCAB_BLOCK,
  TAIWAN_USAGE_RULES,
} from "@/lib/prompts/shared";
import { L1_CATEGORIES, MATERIALS } from "@/lib/taxonomy/ontology";
import { renderEditorialBands } from "@/lib/constants/curated-products";

// ---------------------------------------------------------------------------
// Test-local helpers — mirrors the `compileVariables` logic in prompt.ts
// without exporting it (spec says: a 5-line local helper is acceptable).
// ---------------------------------------------------------------------------

const VARIABLE_SOURCES: Record<string, string> = {
  category_list: CATEGORY_LIST,
  subcategory_vocab_block: SUBCATEGORY_VOCAB_BLOCK,
  material_vocab_block: MATERIAL_VOCAB_BLOCK,
  taiwan_usage_rules: TAIWAN_USAGE_RULES,
  editorial_bands: renderEditorialBands(),
};

function compiledSnapshotPrompt(name: string): string {
  const entry = snapshot.prompts[name as keyof typeof snapshot.prompts];
  if (!entry) throw new Error(`Unknown snapshot prompt: "${name}"`);
  const raw = entry.text.join("\n");
  return raw.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    return key in VARIABLE_SOURCES ? VARIABLE_SOURCES[key] : `{{${key}}}`;
  });
}

// ---------------------------------------------------------------------------
// Slug-line scanning — the shared `- slug: gloss` line shape used by prompts
// ---------------------------------------------------------------------------

const SLUG_LINE = /^- ([a-z][a-z0-9-]*): /gmu;

const CATEGORY_SLUGS: string[] = L1_CATEGORIES.map((category) => category.slug);
const MATERIAL_SLUGS: string[] = MATERIALS.map((material) => material.slug);

function listedSlugs(text: string): string[] {
  return [...text.matchAll(SLUG_LINE)].map((match) => match[1]!);
}

// ---------------------------------------------------------------------------
// Products prompt tests — re-targeted to compiledSnapshotPrompt("products")
// ---------------------------------------------------------------------------

describe("products snapshot prompt", () => {
  const PRODUCTS = compiledSnapshotPrompt("products");

  it("products_prompt_lists_only_ontology_categories", () => {
    const listed = listedSlugs(PRODUCTS);

    for (const slug of CATEGORY_SLUGS) expect(listed).toContain(slug);
    const known = new Set([...CATEGORY_SLUGS, ...MATERIAL_SLUGS]);
    expect(listed.filter((slug) => !known.has(slug))).toEqual([]);
    expect(listed.filter((slug) => CATEGORY_SLUGS.includes(slug))).toHaveLength(
      CATEGORY_SLUGS.length,
    );
    expect(PRODUCTS).toContain(
      "category (single select, use only the following slugs)",
    );
  });

  it("products_prompt_lists_the_twelve_materials", () => {
    const listed = listedSlugs(PRODUCTS);

    expect(MATERIAL_SLUGS).toHaveLength(12);
    for (const material of MATERIALS) {
      expect(PRODUCTS).toContain(
        `- ${material.slug}: ${material.nameZh}`,
      );
    }
    expect(new Set(listed)).toEqual(
      new Set([...CATEGORY_SLUGS, ...MATERIAL_SLUGS]),
    );
    for (const absent of [
      "plastic",
      "silicone",
      "resin",
      "acrylic",
      "concrete",
    ]) {
      expect(listed).not.toContain(absent);
    }
    expect(PRODUCTS).toContain("no Chinese, no invented values");
  });

  it("products_prompt_forbids_commerce_facts", () => {
    for (const forbidden of [
      "Prices",
      "Discounts",
      "Inventory",
      "availability",
      "variant",
      "offer",
      "shipping",
      "pre-order",
    ]) {
      expect(PRODUCTS.toLowerCase()).toContain(forbidden.toLowerCase());
    }
    expect(PRODUCTS).toContain(
      "The following facts must never be written in any field, even if the source page clearly states them",
    );
    expect(PRODUCTS).toMatch(
      /- \[ \] Are all fields completely free of prices, discounts, inventory, supply status, shipping costs, variants, or offers\?/,
    );
  });

  it("products_prompt_forbids_novel_values", () => {
    expect(PRODUCTS).toMatch(/return null/);
    expect(PRODUCTS).toContain("do not guess");
    expect(PRODUCTS).toContain("do not invent slugs");
    expect(PRODUCTS).toContain(
      "All three lists are closed: values outside these lists must never be output",
    );
    expect(PRODUCTS).toMatch(
      /- \[ \] Have fields with no matching value been returned as null or \[\] rather than invented slugs or guessed values\?/,
    );
  });

  it("products_prompt_wraps_the_output_in_an_object", () => {
    expect(PRODUCTS).toContain(
      "When no products qualify, still return two empty arrays",
    );
    expect(PRODUCTS).toContain("never make the top level an array");
    expect(PRODUCTS).not.toMatch(/^\[\{/m);
  });

  it("products_prompt_uses_the_twenty_item_score_window_and_demands_a_source", () => {
    expect(PRODUCTS).toContain("up to 20 products");
    expect(PRODUCTS).toContain("best valid score minus 15");
    expect(PRODUCTS).toContain("Never pad");
    expect(PRODUCTS).toContain(
      "do not output products without sources",
    );
    expect(PRODUCTS).toContain(
      "Do not write editorial selection reasons",
    );
    expect(PRODUCTS).toContain(
      "official_url must be this specific product's own product page",
    );
  });

  it("anchors listwise selection to the approved editorial bands", () => {
    for (const band of ["0-39", "40-59", "60-74", "75-89", "90-100"]) {
      expect(PRODUCTS).toContain(band);
    }
    for (const nonSignal of [
      "production origin",
      "website polish",
      "brand size",
      "responsiveness",
      "sponsorship",
      "research ease",
    ]) {
      expect(PRODUCTS).toContain(nonSignal);
    }
    expect(PRODUCTS).toContain("listwise");
    expect(PRODUCTS).toContain(
      "Every supplied candidate must have an evaluation",
    );
    expect(PRODUCTS).not.toMatch(/[≥>]\s*70/);
    expect(PRODUCTS).toContain(
      "golden_case_id=products-pool-compact-01 rubric_version=dev-1649-v1",
    );
  });
});

// ---------------------------------------------------------------------------
// Confidence prompt rubric anchors — re-targeted to snapshots
// ---------------------------------------------------------------------------

describe("confidence prompt rubric anchors", () => {
  const prompts = [
    {
      name: "detect",
      ids: [
        "detect-high-curated-shop",
        "detect-medium-own-line-ambiguity",
        "detect-low-sparse-workshop",
      ],
    },
    {
      name: "category-classify",
      ids: [
        "category-high-handmade-soap",
        "category-medium-tea-fragrance",
        "category-low-lifestyle-objects",
      ],
    },
    {
      name: "name-arbiter",
      ids: ["name-high-unigaze", "name-medium-aromase", "name-low-trista"],
    },
    {
      name: "site-identity",
      ids: ["site-high-smore", "site-medium-jaibei", "site-low-1koshijimi"],
    },
  ];

  it.each(prompts)(
    "includes one versioned high, medium, and low anchor ($name)",
    ({ name, ids }) => {
      const prompt = compiledSnapshotPrompt(name);
      for (const id of ids) {
        expect(prompt).toContain(
          `golden_case_id=${id} rubric_version=dev-1649-v1`,
        );
      }
      for (const confidence of ["high", "medium", "low"]) {
        expect(prompt).toContain(`confidence=${confidence}`);
      }
    },
  );
});

// ---------------------------------------------------------------------------
// Snapshot coverage invariants
// ---------------------------------------------------------------------------

describe("snapshot coverage", () => {
  it("every_snapshot_name_has_a_call_site", () => {
    const snapshotNames = Object.keys(snapshot.prompts);
    const srcDir = path.resolve(__dirname, "../../..");
    // Search for each snapshot name as a string literal in src/ .ts files
    for (const name of snapshotNames) {
      const result = execSync(
        `grep -rn "['\\"']${name}['\\"']" "${srcDir}/src/" --include="*.ts" || true`,
        { encoding: "utf-8" },
      ).trim();
      expect(
        result.length > 0,
        `Snapshot prompt "${name}" has no call site in src/`,
      ).toBe(true);
    }
  });

  it("snapshot_text_contains_no_inlined_vocab_blocks", () => {
    const vocabLiterals = [
      CATEGORY_LIST,
      MATERIAL_VOCAB_BLOCK,
      SUBCATEGORY_VOCAB_BLOCK,
      TAIWAN_USAGE_RULES,
    ];

    for (const [name, entry] of Object.entries(snapshot.prompts)) {
      const raw = (entry as { text: string[] }).text.join("\n");
      for (const vocab of vocabLiterals) {
        // Only check entries long enough that they could reasonably contain
        // a full vocab block (short substrings would false-positive).
        if (vocab.length < 50) continue;
        expect(
          raw.includes(vocab),
          `Snapshot "${name}" contains an inlined vocab block that should be a mustache variable`,
        ).toBe(false);
      }
    }
  });
});
