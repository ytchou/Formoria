import { describe, expect, it, vi } from "vitest";
import { setAuditWriteSeam, type AuditRecord } from "@/lib/audit";
import {
  parseDescriptionRewriteResult,
  rewriteBrandDescription,
  descriptionShape,
} from "./description-rewrite";
import { createProfiledOpenAIClient } from "./llm-audit";
import { fetchLangfusePrompt } from "@/lib/langfuse/prompt";

// Partial mock: the profile helpers (`profileChatParams`,
// `buildProfiledEnrichmentConfig`) are the real ones, so these tests still
// exercise the request parameters the descriptions profile actually resolves.
vi.mock("./llm-audit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./llm-audit")>()),
  createProfiledOpenAIClient: vi.fn(),
}));

vi.mock("@/lib/langfuse/prompt", () => ({
  fetchLangfusePrompt: vi.fn().mockImplementation(
    (_name: string, fallback: string) => Promise.resolve(fallback),
  ),
}));

describe("parseDescriptionRewriteResult", () => {
  it("returns null description when the LLM response is not valid JSON — never the raw text", () => {
    const result = parseDescriptionRewriteResult(
      "抱歉，我無法解析，但這裡有超過二十個字元的原始輸出內容",
    );
    expect(result.description).toBeNull();
  });

  it("sanitizes input artifacts and localizes accepted zh fields", async () => {
    const descriptionZh = `信息設計坊${"這個視頻質量很高，信息豐富。".repeat(20)}`;
    const blurbZh = `信息設計坊${"視頻質量很好。".repeat(8)}`;
    const chat = vi.fn().mockResolvedValue({
      response: { ok: true, status: 200 },
      data: {},
      content: JSON.stringify({
        description_zh: descriptionZh,
        description_en: "This brand makes durable goods. ".repeat(10),
        blurb_zh: blurbZh,
        blurb_en: "A durable Taiwanese brand for everyday goods.",
      }),
    });
    vi.mocked(createProfiledOpenAIClient).mockReturnValue({ chat } as never);
    vi.stubEnv("OPENAI_API_KEY", "test-key");

    const output = await rewriteBrandDescription(
      "信息設計坊",
      null,
      ["摘要 https://example.com?utm_source=chatgpt.com&ref=1 turn0search0"],
      "網站內容 citeturn0news2 https://example.com?utm_source=openai",
      {
        jobId: "job-1",
        target: { type: "brand", id: "brand-1" },
      },
    );

    const request = chat.mock.calls.at(0)?.[0];
    expect(request?.user).not.toContain("utm_source=chatgpt.com");
    expect(request?.user).not.toContain("turn0search0");
    expect(request?.user).not.toContain("citeturn0news2");
    expect(request?.user).toContain("https://example.com?ref=1");
    expect(output?.result?.description_zh?.startsWith("信息設計坊")).toBe(true);
    // localizeToTW no longer performs vocabulary substitution: its 48-rule
    // zh-CN table was measured 41-wrong-of-53 on this corpus (it rewrote the
    // correct 審核通過 to 審核透過, and 落地燈 to 執行燈) and was deleted in
    // DEV-1543. This path formats only, so zh-CN vocabulary passes through
    // verbatim — and that is now the INTENDED, tested behavior, not a gap.
    // DEV-1546 resolved the open question (finding C4): the write path detects
    // banned terms and records them on its audit span, and never mutates the
    // text. The audit assertions are the next test in this file.
    expect(output?.result?.description_zh).toContain("視頻");
    expect(output?.result?.description_zh).toContain("質量");
    expect(output?.result?.blurb_zh?.startsWith("信息設計坊")).toBe(true);
    expect(createProfiledOpenAIClient).toHaveBeenCalledWith(
      "descriptions",
      expect.objectContaining({
        jobId: "job-1",
        phase: "descriptions",
        target: { type: "brand", id: "brand-1" },
      }),
      { apiKey: "test-key" },
    );
  });

  /**
   * DEV-1546: the accepted zh text is stored exactly as the model wrote it, and
   * every banned term in it is reported on this call's audit span instead —
   * naming the field and the replacement a human would apply by hand.
   */
  it("reports banned zh vocabulary on the audit span without rewriting it", async () => {
    const auditRecords: AuditRecord[] = [];
    setAuditWriteSeam(async (record) => {
      auditRecords.push(record);
      return null;
    });

    const descriptionZh = `信息設計坊${"這個視頻質量很高，信息豐富。".repeat(20)}`;
    const blurbZh = `信息設計坊${"視頻質量很好。".repeat(8)}`;
    const chat = vi.fn().mockResolvedValue({
      response: { ok: true, status: 200 },
      data: {},
      content: JSON.stringify({
        description_zh: descriptionZh,
        description_en: "This brand makes durable goods. ".repeat(10),
        blurb_zh: blurbZh,
        blurb_en: "A durable Taiwanese brand for everyday goods.",
      }),
    });
    vi.mocked(createProfiledOpenAIClient).mockReturnValue({ chat } as never);
    vi.stubEnv("OPENAI_API_KEY", "test-key");

    const output = await rewriteBrandDescription(
      "信息設計坊",
      null,
      ["摘要"],
      null,
      {
        jobId: "job-1",
        target: { type: "brand", id: "brand-1" },
      },
    );

    expect(output?.result?.description_zh).toContain("視頻");

    const hits = auditRecords.flatMap((record) => {
      const recorded = record.summary?.bannedTerms;
      return Array.isArray(recorded)
        ? (recorded as Array<Record<string, unknown>>)
        : [];
    });
    expect(hits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "description_zh",
          term: "視頻",
          replacement: "影片",
        }),
        expect.objectContaining({ field: "blurb_zh", term: "視頻" }),
      ]),
    );
  });

  it("retries when generated descriptions contain pricing information", async () => {
    const cleanDescriptionZh =
      "品牌以台灣製鞋工藝為核心，從打版、看樣到量產皆由團隊親自監督，產品聚焦於簡約舒適的帆布鞋與防水系列，並透過材質選擇與結構調整回應日常穿著需求。".repeat(
        3,
      );
    const cleanDescriptionEn =
      "The brand develops canvas sneakers in Taiwan, overseeing pattern making, sample reviews, and production while refining materials and construction for comfortable everyday wear. "
        .repeat(3)
        .trim();
    const blurbZh =
      "從打版到量產皆親自把關，以台灣製鞋工藝打造簡約舒適的日常帆布鞋。";
    const blurbEn =
      "Taiwan-made canvas sneakers shaped by close oversight from pattern making through production.";
    const response = (
      descriptionZh: string,
      descriptionEn: string,
      options: { blurbZh?: string; blurbEn?: string } = {},
    ) => ({
      response: { ok: true, status: 200 },
      data: {},
      content: JSON.stringify({
        description_zh: descriptionZh,
        description_en: descriptionEn,
        blurb_zh: options.blurbZh ?? blurbZh,
        blurb_en: options.blurbEn ?? blurbEn,
      }),
    });
    const chat = vi
      .fn()
      .mockResolvedValueOnce(
        response(
          `${cleanDescriptionZh}鞋款價格約 NT$1,316 至 NT$2,980。`,
          `${cleanDescriptionEn} Products are priced around NT$1,316 to NT$2,980.`,
          {
            blurbZh: `${blurbZh} 售價約 NT$1,316 起。`,
            blurbEn: `${blurbEn} Priced from NT$1,316.`,
          },
        ),
      )
      .mockResolvedValueOnce(response(cleanDescriptionZh, cleanDescriptionEn));
    vi.mocked(createProfiledOpenAIClient).mockReturnValue({ chat } as never);
    vi.stubEnv("OPENAI_API_KEY", "test-key");

    const output = await rewriteBrandDescription(
      "Southgate 南登機口",
      null,
      ["品牌以帆布鞋為核心產品。"],
      null,
      { jobId: "job-1", target: { type: "brand", id: "brand-1" } },
    );

    expect(chat).toHaveBeenCalledTimes(2);
    expect(chat.mock.calls[0]?.[0].system).toContain("pricing information");
    expect(output?.attempts[0]?.validationRejections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "description_zh",
          reasons: ["pricing_information"],
        }),
        expect.objectContaining({
          field: "description_en",
          reasons: ["pricing_information"],
        }),
        expect.objectContaining({
          field: "blurb_zh",
          reasons: ["pricing_information"],
        }),
        expect.objectContaining({
          field: "blurb_en",
          reasons: ["pricing_information"],
        }),
      ]),
    );
    expect(output?.result?.description_zh).toBe(cleanDescriptionZh);
    expect(output?.result?.description_en).toBe(cleanDescriptionEn);
  });

  it("keeps non-pricing financial achievements in descriptions", async () => {
    const descriptionZh = `${"品牌以台灣工藝開發日常用品，從材料選擇、打樣到生產皆由團隊持續調整，並與在地供應夥伴合作，建立穩定且可追溯的製作流程。".repeat(3)}品牌曾透過群眾集資募得新台幣5,000,000元，用於擴大產品開發。`;
    const descriptionEn = `${"The brand develops everyday goods in Taiwan, refining materials, prototypes, and production with local partners to maintain a stable and traceable manufacturing process. ".repeat(3)}Its crowdfunding campaign raised NT$5 million to expand product development.`;
    const chat = vi.fn().mockResolvedValue({
      response: { ok: true, status: 200 },
      data: {},
      content: JSON.stringify({
        description_zh: descriptionZh,
        description_en: descriptionEn,
        blurb_zh:
          "以台灣工藝開發日常用品，串連在地供應夥伴建立穩定且可追溯的製作流程，持續改善產品品質。",
        blurb_en:
          "Taiwan-made everyday goods developed through a stable, traceable process with local partners.",
      }),
    });
    vi.mocked(createProfiledOpenAIClient).mockReturnValue({ chat } as never);
    vi.stubEnv("OPENAI_API_KEY", "test-key");

    const output = await rewriteBrandDescription(
      "集資品牌",
      null,
      ["品牌完成群眾集資。"],
      null,
      { jobId: "job-1", target: { type: "brand", id: "brand-1" } },
    );

    expect(chat).toHaveBeenCalledTimes(1);
    expect(output?.result?.description_zh).toContain("新台幣5,000,000元");
    expect(output?.result?.description_en).toContain("raised NT$5 million");
  });
});

describe("DESCRIPTION_SCHEMA", () => {
  it("has four required string fields", () => {
    const requiredFields = ["description_zh", "description_en", "blurb_zh", "blurb_en"] as const;
    const shapeKeys = Object.keys(descriptionShape.shape);
    for (const field of requiredFields) {
      expect(shapeKeys, `${field} should be a key in the Zod shape`).toContain(field);
      // Each field is a z.string() — in Zod 4 its _def.type is "string"
      expect(
        (descriptionShape.shape[field] as { _def: { type: string } })._def.type,
        `${field} should be z.string()`,
      ).toBe("string");
    }
  });

  it("passes taiwan_usage_rules variable to fetchLangfusePrompt", async () => {
    const chat = vi.fn().mockResolvedValue({
      response: { ok: true, status: 200 },
      data: {},
      content: JSON.stringify({
        description_zh: "台灣品牌以手工皮革製品為核心，從選料、裁切到車縫皆由工匠親手完成，產品涵蓋長夾、零錢包與證件套，以植鞣牛皮搭配手工上色工序，打造具使用痕跡質感的皮件。",
        description_en: "This Taiwanese brand centers on handcrafted leather goods, with artisans personally handling material selection, cutting, and stitching to produce wallets, coin purses, and card holders from vegetable-tanned cowhide finished with hand-dyed techniques.",
        blurb_zh: "以植鞣牛皮與手工上色打造長夾、零錢包等皮件，強調使用痕跡帶來的獨特質感。",
        blurb_en: "Handcrafted vegetable-tanned leather goods shaped by artisan dyeing and natural patina.",
      }),
    });
    vi.mocked(createProfiledOpenAIClient).mockReturnValue({ chat } as never);
    vi.stubEnv("OPENAI_API_KEY", "test-key");

    await rewriteBrandDescription(
      "TestBrand",
      null,
      ["摘要"],
      null,
      { jobId: "job-1", target: { type: "brand", id: "brand-1" } },
    );

    expect(fetchLangfusePrompt).toHaveBeenCalledWith(
      "descriptions",
      expect.any(String),
      expect.objectContaining({
        taiwan_usage_rules: expect.any(String),
      }),
    );
  });
});
