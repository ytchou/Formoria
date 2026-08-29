import { describe, expect, it } from "vitest";
import {
  CLASSIFY_SYSTEM_PROMPT,
  DETECT_SYSTEM_PROMPT,
  NAME_ARBITER_SYSTEM_PROMPT,
  PRODUCTS_SYSTEM_PROMPT,
  SITE_IDENTITY_SYSTEM_PROMPT,
} from "@/lib/prompts";
import { L1_CATEGORIES, MATERIALS } from "@/lib/taxonomy/ontology";

/**
 * The curated-product proposal prompt (DEV-1469).
 *
 * Every closed vocabulary the prompt carries is interpolated from
 * `@/lib/taxonomy/ontology`, so these assertions are written against the
 * ontology rather than against a copy of its values: a taxonomy change that
 * left a hand-typed list behind in the prompt has to fail here, which is the
 * whole point of the file.
 *
 * The shared `- slug: gloss` line shape is the one `FACTS_SYSTEM_PROMPT` uses
 * for its closed lists, so a single scan finds both blocks and can assert the
 * union is exactly the two ratified vocabularies — no thirteenth material, no
 * invented L1 category.
 */
const SLUG_LINE = /^- ([a-z][a-z0-9-]*): /gmu;

function listedSlugs(): string[] {
  return [...PRODUCTS_SYSTEM_PROMPT.matchAll(SLUG_LINE)].map(
    (match) => match[1]!,
  );
}

const CATEGORY_SLUGS: string[] = L1_CATEGORIES.map((category) => category.slug);
const MATERIAL_SLUGS: string[] = MATERIALS.map((material) => material.slug);

describe("PRODUCTS_SYSTEM_PROMPT", () => {
  it("products_prompt_lists_only_ontology_categories", () => {
    const listed = listedSlugs();

    for (const slug of CATEGORY_SLUGS) expect(listed).toContain(slug);
    // No slug-shaped line the ontology cannot account for: a hand-typed extra
    // category (or a stale one left behind by a rename) shows up right here.
    const known = new Set([...CATEGORY_SLUGS, ...MATERIAL_SLUGS]);
    expect(listed.filter((slug) => !known.has(slug))).toEqual([]);
    // Listed once each, so a copy-paste of the block cannot pass the checks above.
    expect(listed.filter((slug) => CATEGORY_SLUGS.includes(slug))).toHaveLength(
      CATEGORY_SLUGS.length,
    );
    expect(PRODUCTS_SYSTEM_PROMPT).toContain(
      "category (single select, use only the following slugs)",
    );
  });

  it("products_prompt_lists_the_twelve_materials", () => {
    const listed = listedSlugs();

    expect(MATERIAL_SLUGS).toHaveLength(12);
    // Slug AND Chinese gloss: the model reads a Chinese product page, so it has
    // to be able to recognise 陶瓷 and still answer `ceramic`.
    for (const material of MATERIALS) {
      expect(PRODUCTS_SYSTEM_PROMPT).toContain(
        `- ${material.slug}: ${material.nameZh}`,
      );
    }
    // Exactly the two vocabularies and nothing else — this is the assertion that
    // fails on a thirteenth material added to the prompt but not to MATERIALS
    // (whose CHECK constraint would 23514 the write).
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
    // Slug-only, because `createCuratedProduct`'s material normalisation is
    // slug-only and silently DROPS a Chinese label.
    expect(PRODUCTS_SYSTEM_PROMPT).toContain("no Chinese, no invented values");
  });

  it("products_prompt_forbids_commerce_facts", () => {
    // Formoria never stores a fact a transaction or an inventory event can
    // change. The prohibition is named field by field so the model cannot read
    // an omission as permission.
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
      expect(PRODUCTS_SYSTEM_PROMPT.toLowerCase()).toContain(
        forbidden.toLowerCase(),
      );
    }
    expect(PRODUCTS_SYSTEM_PROMPT).toContain(
      "The following facts must never be written in any field, even if the source page clearly states them",
    );
    // The self-check list repeats it, because the prohibition that is only stated
    // once is the one a long prompt loses.
    expect(PRODUCTS_SYSTEM_PROMPT).toMatch(
      /- \[ \] Are all fields completely free of prices, discounts, inventory, supply status, shipping costs, variants, or offers\?/,
    );
  });

  it("products_prompt_forbids_novel_values", () => {
    expect(PRODUCTS_SYSTEM_PROMPT).toMatch(/return null/);
    expect(PRODUCTS_SYSTEM_PROMPT).toContain("do not guess");
    expect(PRODUCTS_SYSTEM_PROMPT).toContain("do not invent slugs");
    expect(PRODUCTS_SYSTEM_PROMPT).toContain(
      "All three lists are closed: values outside these lists must never be output",
    );
    expect(PRODUCTS_SYSTEM_PROMPT).toMatch(
      /- \[ \] Have fields with no matching value been returned as null or \[\] rather than invented slugs or guessed values\?/,
    );
  });

  it("products_prompt_wraps_the_output_in_an_object", () => {
    // `response_format: {type: "json_object"}` makes a top-level array an illegal
    // reply — asking for one returned an empty object on every call of the
    // DEV-1321 eval. See NAME_ARBITRATION_SCHEMA in name-arbiter.ts.
    expect(PRODUCTS_SYSTEM_PROMPT).toContain(
      "When no products qualify, still return two empty arrays",
    );
    expect(PRODUCTS_SYSTEM_PROMPT).toContain(
      "never make the top level an array",
    );
    expect(PRODUCTS_SYSTEM_PROMPT).not.toMatch(/^\[\{/m);
  });

  it("products_prompt_uses_the_twenty_item_score_window_and_demands_a_source", () => {
    expect(PRODUCTS_SYSTEM_PROMPT).toContain("up to 20 products");
    expect(PRODUCTS_SYSTEM_PROMPT).toContain("best valid score minus 15");
    expect(PRODUCTS_SYSTEM_PROMPT).toContain("Never pad");
    expect(PRODUCTS_SYSTEM_PROMPT).toContain(
      "do not output products without sources",
    );
    // The one editorial text field carries durable facts only: DEV-1496 abolished
    // the per-product selection reason, so the prompt must not ask for one back.
    expect(PRODUCTS_SYSTEM_PROMPT).toContain(
      "Do not write editorial selection reasons",
    );
    expect(PRODUCTS_SYSTEM_PROMPT).toContain(
      "official_url must be this specific product's own product page",
    );
  });

  it("anchors listwise selection to the approved editorial bands", () => {
    for (const band of ["0-39", "40-59", "60-74", "75-89", "90-100"]) {
      expect(PRODUCTS_SYSTEM_PROMPT).toContain(band);
    }
    for (const nonSignal of [
      "production origin",
      "website polish",
      "brand size",
      "responsiveness",
      "sponsorship",
      "research ease",
    ]) {
      expect(PRODUCTS_SYSTEM_PROMPT).toContain(nonSignal);
    }
    expect(PRODUCTS_SYSTEM_PROMPT).toContain("listwise");
    expect(PRODUCTS_SYSTEM_PROMPT).toContain(
      "Every supplied candidate must have an evaluation",
    );
    expect(PRODUCTS_SYSTEM_PROMPT).not.toMatch(/[≥>]\s*70/);
    expect(PRODUCTS_SYSTEM_PROMPT).toContain(
      "golden_case_id=products-pool-compact-01 rubric_version=dev-1649-v1",
    );
  });
});

describe("confidence prompt rubric anchors", () => {
  const prompts = [
    {
      prompt: DETECT_SYSTEM_PROMPT,
      ids: [
        "detect-high-curated-shop",
        "detect-medium-own-line-ambiguity",
        "detect-low-sparse-workshop",
      ],
    },
    {
      prompt: CLASSIFY_SYSTEM_PROMPT,
      ids: [
        "category-high-handmade-soap",
        "category-medium-tea-fragrance",
        "category-low-lifestyle-objects",
      ],
    },
    {
      prompt: NAME_ARBITER_SYSTEM_PROMPT,
      ids: ["name-high-unigaze", "name-medium-aromase", "name-low-trista"],
    },
    {
      prompt: SITE_IDENTITY_SYSTEM_PROMPT,
      ids: ["site-high-smore", "site-medium-jaibei", "site-low-1koshijimi"],
    },
  ];

  it.each(prompts)(
    "includes one versioned high, medium, and low anchor",
    ({ prompt, ids }) => {
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
