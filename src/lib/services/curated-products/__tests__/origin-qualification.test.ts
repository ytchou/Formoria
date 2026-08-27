import { describe, expect, it } from "vitest";
import {
  assessDeterministicOrigin,
  buildOriginExcerpts,
  classifyRegistryRecord,
  decideOriginQualification,
  isRegistryRecordActive,
  normalizeRegistryValue,
  rankOriginCandidates,
  selectExactRegistryMatch,
  type RegistryOriginRecord,
} from "../origin-qualification";
import { extractRenderedMainText } from "../../enrich-phases/scraper/product-origin-text";

const NOW = new Date("2026-08-26T00:00:00.000Z");

function registryRecord(
  overrides: Partial<RegistryOriginRecord> = {},
): RegistryOriginRecord {
  return {
    id: "registry-1",
    certNumber: "01700577-00001",
    normalizedBrand: "rafac",
    normalizedProduct: "戶外機能動動襪",
    normalizedModel: "s01a迷彩",
    validUntil: "20270825",
    syncedAt: "2026-08-25T00:00:00.000Z",
    ...overrides,
  };
}

describe("product origin qualification", () => {
  it("extracts rendered main-product text without site chrome", () => {
    const text = extractRenderedMainText(`
      <html><body>
        <nav>台灣製造品牌導覽</nav>
        <main><h1>機能襪</h1><p>本產品於台灣製造，所有材料皆來自台灣。</p></main>
        <footer>全館從台灣出貨</footer>
      </body></html>
    `);

    expect(text).toBe("機能襪 本產品於台灣製造，所有材料皆來自台灣。");
  });

  it("rejects Taiwan design, shipping, and supervision as manufacturing proof", () => {
    const assessment = assessDeterministicOrigin(
      buildOriginExcerpts(
        "candidate-1",
        "台灣設計，於越南製造。由台灣團隊監製，商品從台北出貨。",
      ),
    );

    expect(assessment.madeInTaiwan).toBe(false);
    expect(assessment.materialsFromTaiwan).toBe(false);
  });

  it("requires explicit complete material coverage", () => {
    const partial = assessDeterministicOrigin(
      buildOriginExcerpts(
        "candidate-2",
        "本產品於台灣製造，主要材料之一為台灣棉，其餘材料來源未說明。",
      ),
    );
    const complete = assessDeterministicOrigin(
      buildOriginExcerpts(
        "candidate-3",
        "本產品於台灣製造，所有主要原料與材料均為台灣生產。",
      ),
    );

    expect(partial.madeInTaiwan).toBe(true);
    expect(partial.materialsFromTaiwan).toBe(false);
    expect(complete).toMatchObject({
      madeInTaiwan: true,
      materialsFromTaiwan: true,
    });
  });

  it("keeps at most four bounded excerpts with stable IDs", () => {
    const text = Array.from(
      { length: 8 },
      (_, index) => `第${index + 1}段：台灣製造，所有材料皆來自台灣。`,
    ).join("無關的商品使用說明".repeat(40));

    const excerpts = buildOriginExcerpts("candidate-4", text);

    expect(excerpts).toHaveLength(4);
    expect(excerpts.map((excerpt) => excerpt.id)).toEqual([
      "candidate-4:origin:1",
      "candidate-4:origin:2",
      "candidate-4:origin:3",
      "candidate-4:origin:4",
    ]);
    expect(excerpts.every((excerpt) => excerpt.text.length <= 320)).toBe(true);
  });

  it("fails consensus qualification when evaluators disagree", () => {
    expect(
      decideOriginQualification({
        deterministic: {
          madeInTaiwan: true,
          materialsFromTaiwan: true,
          excerptIds: ["e1"],
        },
        llm: {
          madeInTaiwan: true,
          materialsFromTaiwan: false,
          excerptIds: ["e1"],
        },
        registry: { matched: false, recordId: null, reason: "no_exact_match" },
      }),
    ).toEqual({ qualified: false, method: null });
  });

  it("normalizes registry values without fuzzy matching", () => {
    expect(normalizeRegistryValue(" ＲＡＦＡＣ／戶外 機能襪 ")).toBe(
      "rafac戶外機能襪",
    );
  });

  it("selects an exact product/model variant when certificates repeat", () => {
    const match = selectExactRegistryMatch(
      [
        registryRecord({ id: "blue", normalizedModel: "s01a水藍" }),
        registryRecord({ id: "camo", normalizedModel: "s01a迷彩" }),
      ],
      {
        brand: "RAFAC",
        product: "戶外機能動動襪",
        model: "S01A（迷彩）",
      },
      NOW,
    );

    expect(match?.id).toBe("camo");
    expect(
      selectExactRegistryMatch(
        [registryRecord({ normalizedModel: "s01a迷彩" })],
        { brand: "RAFAC", product: "戶外機能動動襪" },
        NOW,
      ),
    ).toBeNull();
  });

  it("rejects missing, malformed, expired, and stale registry state", () => {
    expect(isRegistryRecordActive(registryRecord(), NOW)).toBe(true);
    expect(
      isRegistryRecordActive(registryRecord({ validUntil: null }), NOW),
    ).toBe(false);
    expect(classifyRegistryRecord(registryRecord({ validUntil: null }), NOW)).toBe(
      "invalid_expiry",
    );
    expect(
      isRegistryRecordActive(registryRecord({ validUntil: "next year" }), NOW),
    ).toBe(false);
    expect(
      isRegistryRecordActive(registryRecord({ validUntil: "20260825" }), NOW),
    ).toBe(false);
    expect(
      classifyRegistryRecord(registryRecord({ validUntil: "20260825" }), NOW),
    ).toBe("expired");
    expect(
      isRegistryRecordActive(
        registryRecord({ syncedAt: "2026-08-17T23:59:59.000Z" }),
        NOW,
      ),
    ).toBe(false);
    expect(
      classifyRegistryRecord(
        registryRecord({ syncedAt: "2026-08-17T23:59:59.000Z" }),
        NOW,
      ),
    ).toBe("stale");
  });

  it("uses MIT only inside editorial-score ties, then search order", () => {
    const ranked = rankOriginCandidates([
      { id: "outside", editorialScore: 91, mitQualified: false, searchPosition: 9 },
      { id: "mit", editorialScore: 90, mitQualified: true, searchPosition: 8 },
      { id: "plain", editorialScore: 90, mitQualified: false, searchPosition: 1 },
      { id: "mit-later", editorialScore: 90, mitQualified: true, searchPosition: 10 },
    ]);

    expect(ranked.map((candidate) => candidate.id)).toEqual([
      "outside",
      "mit",
      "mit-later",
      "plain",
    ]);
  });
});
