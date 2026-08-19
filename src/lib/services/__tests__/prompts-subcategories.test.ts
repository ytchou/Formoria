import { describe, it, expect } from "vitest";
import {
  DETECT_SYSTEM_PROMPT,
  FACTS_SYSTEM_PROMPT,
  SUBCATEGORY_VOCAB_BLOCK,
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
    expect(FACTS_SYSTEM_PROMPT).toContain(SUBCATEGORY_VOCAB_BLOCK);

    // The output contract asks for the slug, not the zh-TW label it replaced.
    expect(FACTS_SYSTEM_PROMPT).toContain(
      '"subcategories": ["子類別 slug（只能用下方「商品子類別詞彙表」中的 slug，一字不差）"]',
    );
  });

  it("material_vocab_block_lists_slug_and_gloss", () => {
    // `MATERIALS.join()` over the slug objects rendered `[object Object]` —
    // the model was handed twelve of them and no vocabulary at all. Slug first
    // because the slug is what `brands.material` stores and what the CHECK
    // constraint accepts; the zh gloss rides along only so a model reading a
    // zh-TW product page can recognise which slug it is looking at.
    for (const material of MATERIALS) {
      expect(FACTS_SYSTEM_PROMPT).toContain(
        `- ${material.slug}: ${material.nameZh}`,
      );
    }
    expect(FACTS_SYSTEM_PROMPT).toContain("- ceramic: 陶瓷");
    expect(FACTS_SYSTEM_PROMPT).not.toContain("[object Object]");
  });

  it("material_rule_demands_slugs_and_bans_labels", () => {
    // Same wording rule the subcategory half already carries at rule 2: the
    // closed list is offered as slugs and only slugs come back. A zh label is
    // not repaired downstream, it is dropped — so the prompt has to say so.
    expect(FACTS_SYSTEM_PROMPT).toContain(
      "材質詞彙表（封閉清單，只能使用下列 slug）：",
    );
    expect(FACTS_SYSTEM_PROMPT).toContain("material 只接受英文 slug");
    expect(FACTS_SYSTEM_PROMPT).toContain(
      "填中文標籤（例如「陶瓷」）會被丟棄",
    );
    expect(FACTS_SYSTEM_PROMPT).toContain("slug 一律是小寫英文與連字號");
    // The output schema asks for the slug too, not the zh-TW term it replaced.
    expect(FACTS_SYSTEM_PROMPT).toContain(
      '"material": ["材質 slug（只能用下方「材質詞彙表」中的英文 slug，一字不差）"]',
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
      "6. 材質屬於另一個軸線：不要用材質詞當子類別，材質請改填 material 欄位。",
    );
    expect(FACTS_SYSTEM_PROMPT).toContain("material（材質）：");
    // Rule 4 no longer lists 材質 or 原料 among the disqualifying kinds.
    expect(FACTS_SYSTEM_PROMPT).not.toContain(
      "不得是場合、收件對象、包裝形式、履約方式、服務或材質",
    );
    // Nor does the self-check.
    expect(FACTS_SYSTEM_PROMPT).not.toContain(
      "而不是 L1、場合、包裝、服務、材質或 SKU 層級詞",
    );
    expect(FACTS_SYSTEM_PROMPT).toContain(
      "material 是否全部是材質詞彙表中的英文 slug（沒有中文標籤），且每一項都有來源依據？",
    );
    // Material is evidence-bound; it is never inferred from a photo.
    expect(FACTS_SYSTEM_PROMPT).toContain("不可從照片外觀推測");
  });

  it("occasion_and_service_remain_banned", () => {
    // Inverting the material half must not loosen the others: occasion,
    // recipient, packaging and service are not product kinds and have no node
    // at any level (`EVICTED_LABELS`).
    expect(FACTS_SYSTEM_PROMPT).toContain(
      "4. 場合、收件對象、包裝形式、履約方式與服務都不是商品種類（例如送禮、彌月、禮盒、伴手禮、體驗課程、服務），不得為了收錄它們而勉強對應到任何 slug。",
    );
    for (const banned of ["送禮", "彌月", "禮盒", "伴手禮", "體驗課程", "服務"]) {
      expect(FACTS_SYSTEM_PROMPT).toContain(banned);
    }
    expect(FACTS_SYSTEM_PROMPT).toContain(
      "是否沒有把 L1、場合、包裝、服務或 SKU 層級詞當成子類別？",
    );
  });

  it("closes the vocabulary — no novel-subcategory escape hatch remains", () => {
    expect(FACTS_SYSTEM_PROMPT).toContain(
      "1. 只能輸出上表出現過的 slug，一字不差；找不到合適的 slug 時寧可少填，不可自創標籤。",
    );
    expect(FACTS_SYSTEM_PROMPT).not.toContain("僅當找不到合適詞彙時");
    expect(FACTS_SYSTEM_PROMPT).not.toContain("novel subcategory");
  });

  it("instructs two-step extraction and vocabulary preference", () => {
    expect(FACTS_SYSTEM_PROMPT).toMatch(/先.*產品線|先列出/);
    expect(FACTS_SYSTEM_PROMPT).toMatch(/優先.*詞彙表|從.*詞彙表.*選/);
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
    expect(FACTS_SYSTEM_PROMPT).toContain("可驗證的購買管道");
    expect(FACTS_SYSTEM_PROMPT).toContain("自主設計或生產的實體商品");
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
    expect(FACTS_SYSTEM_PROMPT).toContain("核心產品線");
  });
});
