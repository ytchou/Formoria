import { describe, it, expect } from "vitest";
import snapshot from "@/lib/prompts/langfuse-snapshot.json";
import {
  CATEGORY_LIST,
  SUBCATEGORY_VOCAB_BLOCK,
  MATERIAL_VOCAB_BLOCK,
} from "@/lib/prompts/shared";
import { L2_SUBCATEGORIES, MATERIALS } from "@/lib/taxonomy/ontology";

// ---------------------------------------------------------------------------
// Test-local helper — mirrors the `compileVariables` logic in prompt.ts
// ---------------------------------------------------------------------------

const VARIABLE_SOURCES: Record<string, string> = {
  category_list: CATEGORY_LIST,
  subcategory_vocab_block: SUBCATEGORY_VOCAB_BLOCK,
  material_vocab_block: MATERIAL_VOCAB_BLOCK,
};

function compiledSnapshotPrompt(name: string): string {
  const entry = snapshot.prompts[name as keyof typeof snapshot.prompts];
  if (!entry) throw new Error(`Unknown snapshot prompt: "${name}"`);
  const raw = entry.text.join("\n");
  return raw.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    return key in VARIABLE_SOURCES ? VARIABLE_SOURCES[key] : `{{${key}}}`;
  });
}

// Re-targeted from the deleted FACTS_SYSTEM_PROMPT / DETECT_SYSTEM_PROMPT
// constants to the compiled snapshot.
const FACTS = compiledSnapshotPrompt("brand-facts");
const DETECT = compiledSnapshotPrompt("detect");

describe("brand-facts snapshot subcategories vocabulary", () => {
  it("vocab_block_emits_slugs_with_zh_gloss", () => {
    expect(SUBCATEGORY_VOCAB_BLOCK).toContain(
      "- bags-accessories（包袋配件）：",
    );
    expect(SUBCATEGORY_VOCAB_BLOCK).toContain("tote-bags（托特包：帆布包）");
    expect(SUBCATEGORY_VOCAB_BLOCK).toContain(
      "clasp-frame-bags（口金包：口金零錢包、口金夾）",
    );
    expect(SUBCATEGORY_VOCAB_BLOCK).toContain(
      "handmade-soap（手工皂：冷製皂、洗顏皂）",
    );

    for (const subcategory of L2_SUBCATEGORIES) {
      const aliasSuffix =
        subcategory.aliases.length > 0
          ? `：${subcategory.aliases.join("、")}`
          : "";
      expect(SUBCATEGORY_VOCAB_BLOCK).toContain(
        `${subcategory.slug}（${subcategory.nameZh}${aliasSuffix}）`,
      );
    }
    expect(FACTS).toContain(SUBCATEGORY_VOCAB_BLOCK);

    expect(FACTS).toContain(
      '"subcategories": ["subcategory slug (use only slugs from the \'Product subcategory vocabulary\' below, verbatim)"]',
    );
  });

  it("material_vocab_block_lists_slug_and_gloss", () => {
    for (const material of MATERIALS) {
      expect(FACTS).toContain(
        `- ${material.slug}: ${material.nameZh}`,
      );
    }
    expect(FACTS).toContain("- ceramic: 陶瓷");
    expect(FACTS).not.toContain("[object Object]");
  });

  it("material_rule_demands_slugs_and_bans_labels", () => {
    expect(FACTS).toContain(
      "Material vocabulary (closed list — use only the following slugs):",
    );
    expect(FACTS).toContain("material accepts only English slugs");
    expect(FACTS).toContain(
      "Chinese labels (e.g. 「陶瓷」) will be discarded",
    );
    expect(FACTS).toContain("slugs are always lowercase English with hyphens");
    expect(FACTS).toContain(
      '"material": ["material slug (use only English slugs from the \'Material vocabulary\' below, verbatim)"]',
    );
    expect(FACTS).not.toContain(
      '"material": ["材質（只能用下方「材質詞彙表」中的詞）"]',
    );
  });

  it("material_is_requested_not_banned", () => {
    expect(FACTS).toContain(
      "6. Material belongs to a separate axis: do not use material terms as subcategories — put materials in the material field instead.",
    );
    expect(FACTS).toContain("material:");
    expect(FACTS).not.toContain(
      "不得是場合、收件對象、包裝形式、履約方式、服務或材質",
    );
    expect(FACTS).not.toContain(
      "而不是 L1、場合、包裝、服務、材質或 SKU 層級詞",
    );
    expect(FACTS).toContain(
      "Are all material values English slugs from the material vocabulary (no Chinese labels), each with source evidence?",
    );
    expect(FACTS).toContain("do not infer from photo appearance");
  });

  it("occasion_and_service_remain_banned", () => {
    expect(FACTS).toContain(
      "4. Occasions, recipients, packaging formats, fulfilment methods, and services are not product types (e.g. gifting, baby-month-gifts, gift-boxes, souvenirs, workshops, services) — do not force-map them to any slug.",
    );
    for (const banned of ["gifting", "baby-month-gifts", "gift-boxes", "souvenirs", "workshops", "services"]) {
      expect(FACTS).toContain(banned);
    }
    expect(FACTS).toContain(
      "Are there no L1 categories, occasions, packaging, services, or SKU-level terms used as subcategories?",
    );
  });

  it("closes the vocabulary — no novel-subcategory escape hatch remains", () => {
    expect(FACTS).toContain(
      "1. Only output slugs that appear in the table above, verbatim; when no suitable slug exists, leave it out rather than inventing a label.",
    );
    expect(FACTS).not.toContain("僅當找不到合適詞彙時");
    expect(FACTS).not.toContain("novel subcategory");
  });

  it("instructs two-step extraction and vocabulary preference", () => {
    expect(FACTS).toMatch(/First identify.*product lines/);
    expect(FACTS).toMatch(/prefer slugs|from the vocabulary/);
  });

  it("no longer forbids broad categories (old instruction removed)", () => {
    expect(FACTS).not.toContain("不要用寬泛分類");
  });
});

describe("listing criteria are split across the two stages", () => {
  it("keeps the illustrator product test in the early triage stage", () => {
    expect(DETECT).toContain("commission-only illustrator");
    expect(DETECT).toContain("LINE stickers or digital files");
    expect(DETECT).toContain(
      "at least one self-designed physical product",
    );
    expect(DETECT).toContain(
      "there must be evidence of a physical product",
    );
  });

  it("defers the purchase-channel test to the facts stage", () => {
    expect(DETECT).not.toContain("可驗證的購買管道");
    expect(DETECT).toContain("a later stage sees all of those");
    expect(FACTS).toContain("verifiable purchase channel");
    expect(FACTS).toContain("self-designed or self-produced physical products");
  });

  it("never lets the early stage reject on uncertainty", () => {
    expect(DETECT).toContain("Uncertainty is never a rejection");
  });
});

describe("the product category is decided in the facts stage", () => {
  it("drops the category from the detect contract", () => {
    expect(DETECT).not.toContain("categorySlug");
    expect(DETECT).not.toContain("## Category");
  });

  it("asks the facts stage for a single L1 category slug", () => {
    expect(FACTS).toContain("category");
    expect(FACTS).toContain("bags-accessories");
    expect(FACTS).toContain("core product line");
  });
});
