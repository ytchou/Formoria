import { describe, expect, it } from "vitest";
import type { Brand } from "@/lib/types";
import {
  getBrandFaq,
  type BrandFaqEntrySource,
  type FaqSupabase,
} from "@/lib/services/brand-faq";

function makeBrand(overrides: Partial<Brand> = {}): Brand {
  return {
    id: "brand-1",
    name: "Test Brand",
    slug: "test-brand",
    description: null,
    heroImageUrl: null,
    status: "approved",
    category: null,
    city: null,
    isVerified: false,
    mitStatus: "unverified",
    isDemo: false,
    foundingYear: null,
    reputationSummary: null,
    socialInstagram: null,
    socialThreads: null,
    socialFacebook: null,
    purchaseWebsite: null,
    purchasePinkoi: null,
    purchaseShopee: null,
    purchaseMyship: null,
    otherUrls: [],
    productPhotos: [],
    contactEmail: null,
    priceRange: null,
    productTags: [],
    productTagsEn: [],
    descriptionEn: null,
    blurb: null,
    blurbEn: null,
    imageAlts: [],
    siteContent: null,
    submittedAt: "",
    approvedAt: null,
    createdAt: "",
    updatedAt: "",
    onboardingDismissedAt: null,
    ...overrides,
  };
}

const t = (key: string, params?: Record<string, unknown>) =>
  `${key}|${JSON.stringify(params ?? {})}`;

type StoredRow = {
  preset_id: string;
  position: number;
  question_zh: string | null;
  answer_zh: string | null;
  question_en: string | null;
  answer_en: string | null;
  source: BrandFaqEntrySource;
};

function row(overrides: Partial<StoredRow> & { preset_id: string }): StoredRow {
  return {
    position: 0,
    question_zh: null,
    answer_zh: null,
    question_en: null,
    answer_en: null,
    source: "model",
    ...overrides,
  };
}

function clientDouble(rows: StoredRow[]) {
  let selectCalls = 0;
  const client = {
    from(table: string) {
      if (table !== "brand_faq_entries") throw new Error(`unexpected table: ${table}`);
      const filters: Array<[string, unknown]> = [];
      const builder = {
        select() {
          selectCalls += 1;
          return builder;
        },
        eq(column: string, value: unknown) {
          filters.push([column, value]);
          return builder;
        },
        then(resolve: (result: { data: StoredRow[]; error: null }) => unknown) {
          return Promise.resolve({
            data: rows.filter((candidate) =>
              filters.every(([column, value]) =>
                column === "brand_id" ? value === "brand-1" : true,
              ),
            ),
            error: null,
          }).then(resolve);
        },
      };
      return builder;
    },
    selectCalls: () => selectCalls,
  };
  return client;
}

async function getFaq(
  brand: Brand,
  rows: StoredRow[] = [],
  translate = t,
) {
  const client = clientDouble(rows);
  const items = await getBrandFaq(
    brand.id,
    brand,
    translate,
    "zh-TW",
    null,
    client as unknown as FaqSupabase,
  );
  return { items, selectCalls: client.selectCalls() };
}

describe("getBrandFaq", () => {
  it("renders template floor when no stored answer exists", async () => {
    const { items, selectCalls } = await getFaq(makeBrand({ productTags: ["陶瓷"] }));

    expect(items.find((item) => item.id === "main-products")?.answer).toContain(
      "brandFaq.mainProducts.",
    );
    expect(selectCalls).toBe(1);
  });

  it("prefers a stored model answer over the template floor", async () => {
    const { items } = await getFaq(
      makeBrand({ productTags: ["陶瓷"] }),
      [
        row({
          preset_id: "main-products",
          question_zh: "品牌主要賣什麼？",
          answer_zh: "模型回答",
        }),
      ],
    );

    expect(items.find((item) => item.id === "main-products")).toEqual({
      id: "main-products",
      question: "品牌主要賣什麼？",
      answer: "模型回答",
    });
  });

  it("prefers a human row over a model row", async () => {
    const { items } = await getFaq(makeBrand({ productTags: ["陶瓷"] }), [
      row({
        preset_id: "main-products",
        position: 0,
        source: "model",
        question_zh: "模型問題",
        answer_zh: "模型回答",
      }),
      row({
        preset_id: "main-products",
        position: 1,
        source: "human",
        question_zh: "人工問題",
        answer_zh: "人工回答",
      }),
    ]);

    expect(items.filter((item) => item.id === "main-products")).toEqual([
      { id: "main-products", question: "人工問題", answer: "人工回答" },
    ]);
  });

  it("keeps template floors for other presets when one preset has a stored answer", async () => {
    const { items } = await getFaq(makeBrand({ productTags: ["陶瓷"] }), [
      row({
        preset_id: "main-products",
        question_zh: "主要產品？",
        answer_zh: "陶瓷器皿",
      }),
    ]);

    expect(items.map((item) => item.id)).toEqual(["taiwan-origin", "main-products"]);
  });

  it("omits ineligible presets entirely", async () => {
    const { items } = await getFaq(makeBrand());

    const ids = items.map((item) => item.id);
    // Neither preset is eligible and neither has a stored row, so neither may
    // be padded in with weak content.
    expect(ids).not.toContain("main-products");
    expect(ids).not.toContain("reputation");
    expect(ids).not.toContain("price-positioning");
  });

  it("orders taiwan-origin first", async () => {
    const { items } = await getFaq(makeBrand({ productTags: ["陶瓷"] }));

    expect(items[0].id).toBe("taiwan-origin");
  });
});
