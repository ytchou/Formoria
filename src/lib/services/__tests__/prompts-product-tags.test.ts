import { describe, it, expect } from "vitest";
import { DETECT_SYSTEM_PROMPT, FACTS_SYSTEM_PROMPT } from "@/lib/prompts";

describe("FACTS_SYSTEM_PROMPT product_tags vocabulary", () => {
  it("embeds the subcategory tree grouped by L1 category", () => {
    expect(FACTS_SYSTEM_PROMPT).toContain("包袋配件");
    expect(FACTS_SYSTEM_PROMPT).toContain("口金包");
    expect(FACTS_SYSTEM_PROMPT).toContain("托特包");
    expect(FACTS_SYSTEM_PROMPT).toContain("手工皂");
  });
  it("instructs two-step extraction and vocabulary preference", () => {
    expect(FACTS_SYSTEM_PROMPT).toMatch(/先.*產品線|先列出/);
    expect(FACTS_SYSTEM_PROMPT).toMatch(/優先.*詞彙表|從.*詞彙表.*選/);
  });
  it("no longer forbids broad categories (old instruction removed)", () => {
    expect(FACTS_SYSTEM_PROMPT).not.toContain("不要用寬泛分類");
  });

  it("the product_tags rule forbids the middle dot in novel tags", () => {
    expect(FACTS_SYSTEM_PROMPT).toContain("不含「・」");
  });

  it("the product_tags rule forbids occasion, service and material tags", () => {
    expect(FACTS_SYSTEM_PROMPT).toContain(
      "4. 不得是場合、收件對象、包裝形式、履約方式、服務或材質（例如送禮、彌月、禮盒、伴手禮、體驗課程、服務、原料）。",
    );
  });

  it("the output self-check list covers tag kind and the separator", () => {
    expect(FACTS_SYSTEM_PROMPT).toContain("是否命名具體產品種類");
    expect(FACTS_SYSTEM_PROMPT).toContain("是否不含「・」");
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
    expect(DETECT_SYSTEM_PROMPT).not.toContain("productType");
    expect(DETECT_SYSTEM_PROMPT).not.toContain("## Category");
  });

  it("asks the facts stage for a single L1 category slug", () => {
    expect(FACTS_SYSTEM_PROMPT).toContain("product_type");
    expect(FACTS_SYSTEM_PROMPT).toContain("bags-accessories");
    expect(FACTS_SYSTEM_PROMPT).toContain("核心產品線");
  });
});
