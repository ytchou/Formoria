import { describe, it, expect } from "vitest";
import {
  DETECT_SYSTEM_PROMPT,
  FACTS_SYSTEM_PROMPT,
  SUBCATEGORY_VOCAB_BLOCK,
  MATERIAL_VOCAB_BLOCK,
} from "@/lib/prompts";
import { L2_SUBCATEGORIES, MATERIALS } from "@/lib/taxonomy/ontology";

describe("FACTS_SYSTEM_PROMPT subcategories vocabulary", () => {
  it("vocab_block_emits_slugs_with_zh_gloss", () => {
    // `brands.subcategories` stores slugs since DEV-1510, so the model has to
    // emit the slug itself. The gloss keeps the slug recognisable to a model
    // reading zh-TW source material — the shape `CATEGORY_LIST` already uses
    // for L1 and which demonstrably works.
    expect(SUBCATEGORY_VOCAB_BLOCK).toContain("- bags-accessories（包袋配件）：");
    expect(SUBCATEGORY_VOCAB_BLOCK).toContain("tote-bags（托特包）");
    expect(SUBCATEGORY_VOCAB_BLOCK).toContain("clasp-frame-bags（口金包）");
    expect(SUBCATEGORY_VOCAB_BLOCK).toContain("handmade-soap（手工皂）");

    // Every live node is offered, and every one of them carries its slug.
    for (const subcategory of L2_SUBCATEGORIES) {
      expect(SUBCATEGORY_VOCAB_BLOCK).toContain(
        `${subcategory.slug}（${subcategory.nameZh}）`,
      );
    }
    // The vocab block is now a template variable compiled at runtime by
    // `fetchLangfusePrompt`. The prompt carries the placeholder, and the
    // compiled result will contain the full block.
    expect(FACTS_SYSTEM_PROMPT).toContain("{{subcategory_vocab_block}}");

    // The output contract asks for the slug, not the zh-TW label it replaced.
    expect(FACTS_SYSTEM_PROMPT).toContain(
      '"subcategories": ["subcategory slug (use only slugs from the \'Product subcategory vocabulary\' below, verbatim)"]',
    );
  });

  it("material_vocab_block_lists_slug_and_gloss", () => {
    // The material vocab is now a template variable compiled at runtime.
    // The SUBCATEGORY_VOCAB_BLOCK and MATERIAL_VOCAB_BLOCK are generated from
    // ontology and passed as variables to `fetchLangfusePrompt`. Verify the
    // prompt carries the placeholder, and the shared block itself is correct.
    expect(FACTS_SYSTEM_PROMPT).toContain("{{material_vocab_block}}");
    // The shared block (imported separately) still lists every slug with gloss.
    for (const material of MATERIALS) {
      expect(MATERIAL_VOCAB_BLOCK).toContain(
        `- ${material.slug}: ${material.nameZh}`,
      );
    }
    expect(MATERIAL_VOCAB_BLOCK).toContain("- ceramic: 陶瓷");
    expect(MATERIAL_VOCAB_BLOCK).not.toContain("[object Object]");
  });

  it("material_rule_demands_slugs_and_bans_labels", () => {
    // Same wording rule the subcategory half already carries at rule 2: the
    // closed list is offered as slugs and only slugs come back. A zh label is
    // not repaired downstream, it is dropped — so the prompt has to say so.
    expect(FACTS_SYSTEM_PROMPT).toContain(
      "Material vocabulary (closed list — use only the following slugs):",
    );
    expect(FACTS_SYSTEM_PROMPT).toContain("material accepts only English slugs");
    expect(FACTS_SYSTEM_PROMPT).toContain(
      "Chinese labels (e.g. 「陶瓷」) will be discarded",
    );
    expect(FACTS_SYSTEM_PROMPT).toContain("slugs are always lowercase English with hyphens");
    // The output schema asks for the slug too, not the zh-TW term it replaced.
    expect(FACTS_SYSTEM_PROMPT).toContain(
      '"material": ["material slug (use only English slugs from the \'Material vocabulary\' below, verbatim)"]',
    );
    expect(FACTS_SYSTEM_PROMPT).not.toContain(
      '"material": ["材質（只能用下方「材質詞彙表」中的詞）"]',
    );
  });

  it("material_is_requested_not_banned", () => {
    // Rules 4 and 6 used to ban 材質 outright, which left the material axis
    // with no way to be reported at all. The ban is now scoped to the USE axis
    // and material is asked for on its own axis, against a closed 12-slug list.
    expect(FACTS_SYSTEM_PROMPT).toContain(
      "6. Material belongs to a separate axis: do not use material terms as subcategories — put materials in the material field instead.",
    );
    expect(FACTS_SYSTEM_PROMPT).toContain("material:");
    // Rule 4 no longer lists 材質 or 原料 among the disqualifying kinds.
    expect(FACTS_SYSTEM_PROMPT).not.toContain(
      "不得是場合、收件對象、包裝形式、履約方式、服務或材質",
    );
    // Nor does the self-check.
    expect(FACTS_SYSTEM_PROMPT).not.toContain(
      "而不是 L1、場合、包裝、服務、材質或 SKU 層級詞",
    );
    expect(FACTS_SYSTEM_PROMPT).toContain(
      "Are all material values English slugs from the material vocabulary (no Chinese labels), each with source evidence?",
    );
    // Material is evidence-bound; it is never inferred from a photo.
    expect(FACTS_SYSTEM_PROMPT).toContain("do not infer from photo appearance");
  });

  it("occasion_and_service_remain_banned", () => {
    // Inverting the material half must not loosen the others: occasion,
    // recipient, packaging and service are not product kinds and have no node
    // at any level (`EVICTED_LABELS`).
    expect(FACTS_SYSTEM_PROMPT).toContain(
      "4. Occasions, recipients, packaging formats, fulfilment methods, and services are not product types (e.g. gifting, baby-month-gifts, gift-boxes, souvenirs, workshops, services) — do not force-map them to any slug.",
    );
    for (const banned of ["gifting", "baby-month-gifts", "gift-boxes", "souvenirs", "workshops", "services"]) {
      expect(FACTS_SYSTEM_PROMPT).toContain(banned);
    }
    expect(FACTS_SYSTEM_PROMPT).toContain(
      "Are there no L1 categories, occasions, packaging, services, or SKU-level terms used as subcategories?",
    );
  });

  it("closes the vocabulary — no novel-subcategory escape hatch remains", () => {
    expect(FACTS_SYSTEM_PROMPT).toContain(
      "1. Only output slugs that appear in the table above, verbatim; when no suitable slug exists, leave it out rather than inventing a label.",
    );
    expect(FACTS_SYSTEM_PROMPT).not.toContain("僅當找不到合適詞彙時");
    expect(FACTS_SYSTEM_PROMPT).not.toContain("novel subcategory");
  });

  it("instructs two-step extraction and vocabulary preference", () => {
    expect(FACTS_SYSTEM_PROMPT).toMatch(/First identify.*product lines/);
    expect(FACTS_SYSTEM_PROMPT).toMatch(/prefer slugs|from the vocabulary/);
  });

  it("no longer forbids broad categories (old instruction removed)", () => {
    expect(FACTS_SYSTEM_PROMPT).not.toContain("不要用寬泛分類");
  });
});

describe("listing criteria are split across the two stages", () => {
  // DEV-1277 fixed the illustrator boundary: a creator is a brand only with a
  // real physical product, and only with somewhere to buy it. Both halves still
  // hold, but they are now enforced in different places — detect runs on search
  // snippets alone and cannot see purchase channels, so it judges the product
  // question and defers the channel question to the descriptions call, which
  // runs after links and images (its facts half, since the split). These
  // assertions pin that split, because silently losing either half would
  // re-open DEV-1277.
  it("keeps the illustrator product test in the early triage stage", () => {
    expect(DETECT_SYSTEM_PROMPT).toContain("commission-only illustrator");
    expect(DETECT_SYSTEM_PROMPT).toContain("LINE stickers or digital files");
    expect(DETECT_SYSTEM_PROMPT).toContain(
      "at least one self-designed physical product",
    );
    expect(DETECT_SYSTEM_PROMPT).toContain(
      "there must be evidence of a physical product",
    );
  });

  it("defers the purchase-channel test to the facts stage", () => {
    // Detect must NOT gate on a channel it cannot observe.
    expect(DETECT_SYSTEM_PROMPT).not.toContain("可驗證的購買管道");
    expect(DETECT_SYSTEM_PROMPT).toContain("a later stage sees all of those");
    expect(FACTS_SYSTEM_PROMPT).toContain("verifiable purchase channel");
    expect(FACTS_SYSTEM_PROMPT).toContain("self-designed or self-produced physical products");
  });

  it("never lets the early stage reject on uncertainty", () => {
    expect(DETECT_SYSTEM_PROMPT).toContain("Uncertainty is never a rejection");
  });
});

describe("the product category is decided in the facts stage", () => {
  // Detect judges from SERP snippets alone, before the brand's own site is
  // scraped and before any product photo is seen. The category is a reasoning
  // task, so it belongs to the call that has that evidence.
  it("drops the category from the detect contract", () => {
    expect(DETECT_SYSTEM_PROMPT).not.toContain("categorySlug");
    expect(DETECT_SYSTEM_PROMPT).not.toContain("## Category");
  });

  it("asks the facts stage for a single L1 category slug", () => {
    expect(FACTS_SYSTEM_PROMPT).toContain("category");
    expect(FACTS_SYSTEM_PROMPT).toContain("bags-accessories");
    expect(FACTS_SYSTEM_PROMPT).toContain("core product line");
  });
});
