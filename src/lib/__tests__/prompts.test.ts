import { describe, expect, it } from "vitest";
import { PRODUCTS_SYSTEM_PROMPT } from "@/lib/prompts";
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
  return [...PRODUCTS_SYSTEM_PROMPT.matchAll(SLUG_LINE)].map((match) => match[1]!);
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
    expect(PRODUCTS_SYSTEM_PROMPT).toContain("category（單選，只能填下列 slug）");
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
    expect(new Set(listed)).toEqual(new Set([...CATEGORY_SLUGS, ...MATERIAL_SLUGS]));
    for (const absent of ["plastic", "silicone", "resin", "acrylic", "concrete"]) {
      expect(listed).not.toContain(absent);
    }
    // Slug-only, because `createCuratedProduct`'s material normalisation is
    // slug-only and silently DROPS a Chinese label.
    expect(PRODUCTS_SYSTEM_PROMPT).toContain("不可填中文，不可自創");
  });

  it("products_prompt_forbids_commerce_facts", () => {
    // Formoria never stores a fact a transaction or an inventory event can
    // change. The prohibition is named field by field so the model cannot read
    // an omission as permission.
    for (const forbidden of [
      "售價",
      "折扣",
      "庫存",
      "供應狀況（availability）",
      "規格變體（variant）",
      "offer",
      "運費",
      "預購",
    ]) {
      expect(PRODUCTS_SYSTEM_PROMPT).toContain(forbidden);
    }
    expect(PRODUCTS_SYSTEM_PROMPT).toContain(
      "以下事實一律不可寫進任何欄位，即使來源頁面清楚寫著",
    );
    // The self-check list repeats it, because the prohibition that is only stated
    // once is the one a long prompt loses.
    expect(PRODUCTS_SYSTEM_PROMPT).toMatch(
      /- \[ \] 全部欄位是否完全沒有售價、折扣、庫存、供應狀況、運費、變體或 offer？/,
    );
  });

  it("products_prompt_forbids_novel_values", () => {
    expect(PRODUCTS_SYSTEM_PROMPT).toMatch(/回傳 null/);
    expect(PRODUCTS_SYSTEM_PROMPT).toContain("不可猜測");
    expect(PRODUCTS_SYSTEM_PROMPT).toContain("不可自創 slug");
    expect(PRODUCTS_SYSTEM_PROMPT).toContain(
      "三份清單都是封閉的：清單以外的值一律不可輸出",
    );
    expect(PRODUCTS_SYSTEM_PROMPT).toMatch(
      /- \[ \] 找不到對應值的欄位是否已回傳 null 或 \[\]，而不是自創 slug 或猜測值？/,
    );
  });

  it("products_prompt_wraps_the_output_in_an_object", () => {
    // `response_format: {type: "json_object"}` makes a top-level array an illegal
    // reply — asking for one returned an empty object on every call of the
    // DEV-1321 eval. See NAME_ARBITRATION_SCHEMA in name-arbiter.ts.
    expect(PRODUCTS_SYSTEM_PROMPT).toContain(
      "沒有任何商品符合條件時仍回傳兩個空陣列",
    );
    expect(PRODUCTS_SYSTEM_PROMPT).toContain("絕對不可把最外層寫成陣列");
    expect(PRODUCTS_SYSTEM_PROMPT).not.toMatch(/^\[\{/m);
  });

  it("products_prompt_caps_five_proposals_and_demands_a_source", () => {
    expect(PRODUCTS_SYSTEM_PROMPT).toContain("3–5 件");
    expect(PRODUCTS_SYSTEM_PROMPT).toContain("不要湊數");
    expect(PRODUCTS_SYSTEM_PROMPT).toContain("沒有來源的商品不要輸出");
    // The one editorial text field carries durable facts only: DEV-1496 abolished
    // the per-product selection reason, so the prompt must not ask for one back.
    expect(PRODUCTS_SYSTEM_PROMPT).toContain("不寫選物理由");
    expect(PRODUCTS_SYSTEM_PROMPT).toContain(
      "official_url 必須是這一件商品自己的商品頁",
    );
  });
});
