import { describe, expect, it } from "vitest";

/**
 * The enrichment → `brand_faq` mapping. The model emits a flat zh-then-en
 * list, while the table stores one bilingual object per column, so the pairing
 * rules are worth asserting independently of the database write.
 */
import { buildFaqColumnsFromEnrichment } from "../brand-faq";
import type { EnrichedFaqItem } from "@/lib/types/enriched-data";

function item(
  category: string,
  question: string,
  answer: string,
): EnrichedFaqItem {
  return { category, question, answer };
}

const PRODUCTS_PAIR = [
  item("products", "這個品牌的主要產品有哪些？", "皮件與帆布包。"),
  item("products", "What are the main products?", "Leather goods and totes."),
];

const PRICE_PAIR = [
  item("price", "價格帶是多少？", "NT$1,200 起。"),
  item("price", "What is the price range?", "From NT$1,200."),
];

describe("buildFaqColumnsFromEnrichment", () => {
  it("pairs zh and en items of the same category into one column entry", () => {
    const columns = buildFaqColumnsFromEnrichment([
      ...PRODUCTS_PAIR,
      ...PRICE_PAIR,
    ]);

    expect(columns.faq_products).toEqual({
      question_zh: "這個品牌的主要產品有哪些？",
      answer_zh: "皮件與帆布包。",
      question_en: "What are the main products?",
      answer_en: "Leather goods and totes.",
    });
    expect(columns.faq_price).toEqual({
      question_zh: "價格帶是多少？",
      answer_zh: "NT$1,200 起。",
      question_en: "What is the price range?",
      answer_en: "From NT$1,200.",
    });
  });

  it("maps every fixed category onto its column", () => {
    const columns = buildFaqColumnsFromEnrichment([
      item("where_to_buy", "哪裡買得到？", "官網與 Pinkoi。"),
      item("founded", "什麼時候成立的？", "2018 年。"),
      item("reputation", "評價如何？", "回購率高。"),
    ]);

    expect(Object.keys(columns).sort()).toEqual([
      "faq_founded",
      "faq_reputation",
      "faq_where_to_buy",
    ]);
  });

  it("keeps a half-written pair instead of dropping the answered locale", () => {
    // A model that skips the English half still produced a usable zh answer;
    // losing it would be a worse outcome than a zh-only column.
    const columns = buildFaqColumnsFromEnrichment([
      item("products", "主要產品有哪些？", "皮件。"),
    ]);

    expect(columns.faq_products).toEqual({
      question_zh: "主要產品有哪些？",
      answer_zh: "皮件。",
      question_en: null,
      answer_en: null,
    });
  });

  it("ignores an unknown category rather than throwing", () => {
    const columns = buildFaqColumnsFromEnrichment([
      item("shipping_policy", "運費多少？", "滿千免運。"),
      ...PRODUCTS_PAIR,
    ]);

    expect(Object.keys(columns)).toEqual(["faq_products"]);
  });

  it("fills faq_custom_1..4 in order and drops the fifth pair", () => {
    const customs = [1, 2, 3, 4, 5].flatMap((index) => [
      item("custom", `自訂問題 ${index}？`, `自訂回答 ${index}。`),
      item("custom", `Custom question ${index}?`, `Custom answer ${index}.`),
    ]);

    const columns = buildFaqColumnsFromEnrichment(customs);

    expect(columns.faq_custom_1?.question_zh).toBe("自訂問題 1？");
    expect(columns.faq_custom_2?.question_en).toBe("Custom question 2?");
    expect(columns.faq_custom_3?.answer_zh).toBe("自訂回答 3。");
    expect(columns.faq_custom_4?.answer_en).toBe("Custom answer 4.");
    expect(Object.keys(columns)).toHaveLength(4);
  });
});
