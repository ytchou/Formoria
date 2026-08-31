import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NameCandidate } from "../../name-arbiter";
import {
  applyNamesResult,
  runNamesPhase,
} from "../names";
import type { BatchPhaseContext, EnrichBrand, EnrichPhase } from "../types";

/**
 * The batch helper is mocked (rather than spied) because vitest cannot
 * redefine a live ESM export binding. `importOriginal` keeps the parser and
 * the rest of the arbiter module real.
 */
const mocks = vi.hoisted(() => ({ arbitrateBrandNames: vi.fn() }));

vi.mock("../../name-arbiter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../name-arbiter")>()),
  arbitrateBrandNames: mocks.arbitrateBrandNames,
}));

const brand = (
  id: string,
  slug: string,
  name: string,
): EnrichBrand => ({
  id,
  slug,
  name,
});

function candidate(
  source: NameCandidate["source"],
  value: string,
): NameCandidate {
  return { source, value };
}

function context(
  brands: EnrichBrand[],
  phases: EnrichPhase[] = ["names"] as EnrichPhase[],
  jobId?: string,
): BatchPhaseContext {
  return {
    chunk: brands,
    chunkBrandNames: brands.map((item) => item.name ?? item.slug),
    phases,
    dryRun: true,
    supabase: null as unknown as BatchPhaseContext["supabase"],
    ...(jobId ? { jobId } : {}),
  };
}

describe("runNamesPhase", () => {
  beforeEach(() => {
    mocks.arbitrateBrandNames.mockReset();
  });

  it("filters unanimous normalized candidates without an LLM call", async () => {
    const target = brand("brand-74ounce", "74ounce", "74OUNCE");
    const result = await runNamesPhase(
      context([target]),
      new Map([
        [
          target.id,
          {
            candidates: [
              candidate("stored", "74OUNCE"),
              candidate("cleaned", " 74OUNCE "),
            ],
          },
        ],
      ]),
    );

    expect(mocks.arbitrateBrandNames).not.toHaveBeenCalled();
    expect(result.phaseResult.status).toBe("skipped");
    expect(result.phaseResult.detail).toBe("no disagreeing candidates");
    expect(result.verdicts).toEqual(new Map());
  });

  it("makes one batch call and re-keys verdicts by target id", async () => {
    const first = brand("brand-74ounce", "74ounce", "74OUNCE");
    const second = brand("brand-adela", "adela", "ADELA");
    mocks.arbitrateBrandNames.mockResolvedValue({
      results: new Map([
        [
          first.slug,
          { chosen: "74OUNCE", confidence: "high", reason: "保留品牌名" },
        ],
        [
          second.slug,
          { chosen: "Adela 愛德拉", confidence: "high", reason: "採用雙語名" },
        ],
      ]),
      calls: { attempted: 1, providerFailed: 0 },
    });

    const result = await runNamesPhase(
      context([first, second], ["names"] as EnrichPhase[], "job-dev-1321"),
      new Map([
        [
          first.id,
          {
            candidates: [
              candidate("stored", "74OUNCE"),
              candidate("detected", "74OUNCE BAGSMART"),
            ],
            snippets: ["74OUNCE official site"],
          },
        ],
        [
          second.id,
          {
            candidates: [
              candidate("stored", "ADELA"),
              candidate("scraped", "Adela 愛德拉"),
            ],
          },
        ],
      ]),
    );

    expect(mocks.arbitrateBrandNames).toHaveBeenCalledTimes(1);
    const [items, jobId] = mocks.arbitrateBrandNames.mock.calls[0] ?? [];
    expect(jobId).toBe("job-dev-1321");
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      slug: first.slug,
      storedName: "74OUNCE",
      snippets: ["74OUNCE official site"],
    });
    expect(result.verdicts.get(first.id)?.chosen).toBe("74OUNCE");
    expect(result.verdicts.get(second.id)?.chosen).toBe("Adela 愛德拉");
    expect(result.verdicts.has(first.slug)).toBe(false);
  });

  it("carries the pre-cleanup database name into the arbiter", async () => {
    const target = brand("brand-adela", "adela", "Adela 愛德拉");
    mocks.arbitrateBrandNames.mockResolvedValue({
      results: new Map(),
      calls: { attempted: 1, providerFailed: 1 },
    });

    await runNamesPhase(
      context([target]),
      new Map([
        [
          target.id,
          {
            candidates: [
              candidate("stored", "adela愛德拉 ｜守護家人，為愛研發"),
              candidate("cleaned", "Adela 愛德拉"),
            ],
          },
        ],
      ]),
    );

    const [items] = mocks.arbitrateBrandNames.mock.calls[0] ?? [];
    expect(items[0]?.storedName).toBe("adela愛德拉 ｜守護家人，為愛研發");
    expect(items[0]?.candidates[0]).toEqual({
      source: "stored",
      value: "adela愛德拉 ｜守護家人，為愛研發",
    });
  });

  it("marks an all-provider failure while applyNamesResult keeps the cleaned fallback", async () => {
    const target = brand("brand-hsiao-chu", "hsiao-chu", "首頁 - 小朱甜點");
    mocks.arbitrateBrandNames.mockResolvedValue({
      results: new Map(),
      calls: { attempted: 1, providerFailed: 1 },
    });

    const result = await runNamesPhase(
      context([target]),
      new Map([
        [
          target.id,
          {
            candidates: [
              candidate("stored", "首頁 - 小朱甜點"),
              candidate("cleaned", "小朱甜點"),
              candidate("scraped", "首頁 - 小朱甜點"),
            ],
          },
        ],
      ]),
    );
    const applied = applyNamesResult(
      result.verdicts.get(target.id),
      target,
      [
        candidate("stored", "首頁 - 小朱甜點"),
        candidate("cleaned", "小朱甜點"),
        candidate("scraped", "首頁 - 小朱甜點"),
      ],
    );

    expect(result.phaseResult.status).toBe("failed");
    expect(result.providerFailure).toBe(true);
    expect(applied.patch).toEqual({ name: "小朱甜點" });
  });

  it("rejects a low-confidence verdict and falls back to cleaned", async () => {
    const target = brand("brand-74ounce", "74ounce", "74OUNCE");
    mocks.arbitrateBrandNames.mockResolvedValue({
      results: new Map([
        [
          target.slug,
          {
            chosen: "74OUNCE BAGSMART",
            confidence: "low",
            reason: "候選互相衝突",
          },
        ],
      ]),
      calls: { attempted: 1, providerFailed: 0 },
    });

    const result = await runNamesPhase(
      context([target]),
      new Map([
        [
          target.id,
          {
            candidates: [
              candidate("stored", "74OUNCE"),
              candidate("cleaned", "74OUNCE"),
              candidate("detected", "74OUNCE BAGSMART"),
            ],
          },
        ],
      ]),
    );
    const applied = applyNamesResult(
      result.verdicts.get(target.id),
      target,
      [
        candidate("stored", "74OUNCE"),
        candidate("cleaned", "74OUNCE"),
        candidate("detected", "74OUNCE BAGSMART"),
      ],
    );

    expect(applied.patch).toEqual({});
    expect(applied.phaseResult.changedFields).toEqual([]);
  });

  it("accepts a medium verdict that only strips from the stored name", async () => {
    const target = brand(
      "brand-aromase",
      "aromase",
      "AROMASE 艾瑪絲 頭皮療癒永續品牌",
    );
    mocks.arbitrateBrandNames.mockResolvedValue({
      results: new Map([
        [
          target.slug,
          {
            chosen: "AROMASE 艾瑪絲",
            confidence: "medium",
            reason: "尾段是行銷文案",
          },
        ],
      ]),
      calls: { attempted: 1, providerFailed: 0 },
    });

    const result = await runNamesPhase(
      context([target]),
      new Map([
        [
          target.id,
          {
            candidates: [
              candidate("stored", target.name ?? ""),
              candidate("detected", "AROMASE 艾瑪絲"),
            ],
          },
        ],
      ]),
    );
    const applied = applyNamesResult(
      result.verdicts.get(target.id),
      target,
      [
        candidate("stored", target.name ?? ""),
        candidate("detected", "AROMASE 艾瑪絲"),
      ],
    );

    expect(applied.patch).toEqual({ name: "AROMASE 艾瑪絲" });
    expect(applied.phaseResult.changedFields).toEqual(["name"]);
  });

  it("rejects a medium verdict that adds text the stored name lacks", async () => {
    const target = brand("brand-adela", "adela", "ADELA");
    mocks.arbitrateBrandNames.mockResolvedValue({
      results: new Map([
        [
          target.slug,
          {
            chosen: "Adela 愛德拉",
            confidence: "medium",
            reason: "候選較完整",
          },
        ],
      ]),
      calls: { attempted: 1, providerFailed: 0 },
    });

    const result = await runNamesPhase(
      context([target]),
      new Map([
        [
          target.id,
          {
            candidates: [
              candidate("stored", "ADELA"),
              candidate("scraped", "Adela 愛德拉"),
            ],
          },
        ],
      ]),
    );
    const applied = applyNamesResult(
      result.verdicts.get(target.id),
      target,
      [
        candidate("stored", "ADELA"),
        candidate("scraped", "Adela 愛德拉"),
      ],
    );

    expect(applied.patch).toEqual({});
  });

  it("returns skipped without calling the arbiter when names is not requested", async () => {
    const target = brand("brand-74ounce", "74ounce", "74OUNCE");
    const result = await runNamesPhase(
      context([target], ["links"] as EnrichPhase[]),
      new Map([
        [
          target.id,
          { candidates: [candidate("scraped", "首頁 - 74OUNCE")] },
        ],
      ]),
    );

    expect(mocks.arbitrateBrandNames).not.toHaveBeenCalled();
    expect(result.phaseResult.status).toBe("skipped");
    expect(result.phaseResult.detail).toBe("names phase not requested");
    expect(result.verdicts).toEqual(new Map());
  });

  it("returns skipped for an empty batch", async () => {
    const result = await runNamesPhase(context([]), new Map());

    expect(mocks.arbitrateBrandNames).not.toHaveBeenCalled();
    expect(result.phaseResult.status).toBe("skipped");
    expect(result.phaseResult.detail).toBe("empty batch");
  });
});

/**
 * The guard cases the DEV-1321 eval locked in. They exercise
 * `resolveArbitratedName` through the production entry point, so a change to
 * the confidence gate or the rename guard shows up here rather than only in the
 * paid eval.
 */
describe("applyNamesResult guards", () => {
  const target = brand("brand-74ounce", "74ounce", "74OUNCE 推薦包款 全家人的包");

  it("rejects a medium strip that fails the rename guard", () => {
    const candidates = [
      candidate("stored", "74OUNCE 推薦包款 全家人的包"),
      candidate("cleaned", "74OUNCE"),
      candidate("scraped", "74OUNCE 推薦包款"),
    ];

    const applied = applyNamesResult(
      { chosen: "74OUNCE 推薦包款", confidence: "medium", reason: "去除尾段" },
      target,
      candidates,
    );

    expect(applied.patch).toEqual({ name: "74OUNCE" });
  });

  it("rejects a high verdict that shares no word with the stored name", () => {
    const candidates = [
      candidate("stored", "74OUNCE"),
      candidate("cleaned", "74OUNCE"),
      candidate("detected", "完全不同的品牌"),
    ];

    const applied = applyNamesResult(
      { chosen: "完全不同的品牌", confidence: "high", reason: "模型猜測" },
      brand("brand-74ounce", "74ounce", "74OUNCE"),
      candidates,
    );

    expect(applied.patch).toEqual({});
    expect(applied.phaseResult.changedFields).toEqual([]);
  });

  it("produces an empty patch when the verdict equals the stored name", () => {
    const candidates = [
      candidate("stored", "74OUNCE"),
      candidate("scraped", "74OUNCE BAGSMART 全家人的包"),
    ];

    const applied = applyNamesResult(
      { chosen: "74OUNCE", confidence: "high", reason: "刪除頁面標題文案" },
      brand("brand-74ounce", "74ounce", "74OUNCE"),
      candidates,
    );

    expect(applied.phaseResult.status).toBe("succeeded");
    expect(applied.phaseResult.changedFields).toEqual([]);
    expect(applied.patch).toEqual({});
  });

  it("accepts the exact high-confidence LID Shoes first-party candidate", () => {
    const evidence = [{
      source: "official_website" as const,
      url: "https://www.lidshoes.com",
      observedName: "劉一刀 手工鞋",
    }];
    const candidates: NameCandidate[] = [
      candidate("stored", "LID Shoes"),
      {
        source: "official_website",
        value: "劉一刀 手工鞋 LID Shoes",
        evidence,
      },
    ];

    const applied = applyNamesResult(
      {
        chosen: "劉一刀手工鞋 LID Shoes",
        confidence: "high",
        reason: "官網直接使用雙語品牌名",
      },
      brand("brand-lid", "lid-shoes", "LID Shoes"),
      candidates,
    );

    expect(applied.patch).toEqual({
      name: "劉一刀手工鞋 LID Shoes",
      _name_proposal: {
        value: "劉一刀手工鞋 LID Shoes",
        confidence: "high",
        reason: "官網直接使用雙語品牌名",
        evidence,
      },
    });
  });

  it("rejects a high-confidence value not present in the candidate set", () => {
    const applied = applyNamesResult(
      {
        chosen: "劉一刀鞋坊 LID Shoes",
        confidence: "high",
        reason: "模型自行改寫",
      },
      brand("brand-lid", "lid-shoes", "LID Shoes"),
      [candidate("stored", "LID Shoes")],
    );

    expect(applied.patch).toEqual({});
  });

  it("rejects a medium-confidence bilingual addition even with official evidence", () => {
    const candidateWithEvidence: NameCandidate = {
      source: "official_social",
      value: "愛德拉 Adela",
      evidence: [{
        source: "official_social",
        url: "https://www.instagram.com/adela.tw",
        observedName: "Adela愛德拉",
      }],
    };
    const applied = applyNamesResult(
      {
        chosen: "愛德拉 Adela",
        confidence: "medium",
        reason: "候選可能是品牌名",
      },
      brand("brand-adela", "adela", "ADELA"),
      [candidate("stored", "ADELA"), candidateWithEvidence],
    );

    expect(applied.patch).toEqual({});
  });
});
