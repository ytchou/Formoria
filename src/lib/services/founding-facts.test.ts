import { describe, expect, it } from "vitest";
import {
  acceptedFoundingFactValue,
  deriveFoundingFactAction,
  evaluateFoundingFact,
  type FoundingFactClaim,
} from "./founding-facts";

function claim(overrides: Partial<FoundingFactClaim> = {}): FoundingFactClaim {
  return {
    field: "city",
    value: "taipei",
    citedUrl: "https://harbor-form.tw/about",
    exactExcerpt: "Harbor Form was founded in Taipei in 2019.",
    sourceText: "Harbor Form was founded in Taipei in 2019.",
    sourceType: "first-party",
    reputable: true,
    verification: { passed: true, reason: null },
    locationContext: "founding",
    ...overrides,
  };
}

describe("evaluateFoundingFact", () => {
  it("accepts one explicit verified first-party founding statement as high confidence", () => {
    const result = evaluateFoundingFact("city", [claim()]);

    expect(result.value).toBe("taipei");
    expect(result.confidence).toBe("high");
  });

  it("accepts two agreeing verified independent domains as high confidence", () => {
    const result = evaluateFoundingFact("founding_year", [
      claim({
        field: "founding_year",
        value: 2019,
        citedUrl: "https://design-journal.example/harbor-form",
        sourceType: "independent",
      }),
      claim({
        field: "founding_year",
        value: 2019,
        citedUrl: "https://local-news.example/harbor-form",
        sourceType: "independent",
      }),
    ]);

    expect(result.value).toBe(2019);
    expect(result.confidence).toBe("high");
  });

  it("does not count two pages on the same independent domain twice", () => {
    const result = evaluateFoundingFact("founding_year", [
      claim({
        field: "founding_year",
        value: 2019,
        citedUrl: "https://design-journal.example/harbor-form",
        sourceType: "independent",
      }),
      claim({
        field: "founding_year",
        value: 2019,
        citedUrl: "https://design-journal.example/interviews/harbor-form",
        sourceType: "independent",
      }),
    ]);

    expect(result.confidence).toBe("medium");
  });

  it("does not promote unrated independent pages to high confidence", () => {
    const result = evaluateFoundingFact("founding_year", [
      claim({
        field: "founding_year",
        value: 2019,
        citedUrl: "https://unknown-blog.example/harbor-form",
        sourceType: "independent",
        reputable: false,
      }),
      claim({
        field: "founding_year",
        value: 2019,
        citedUrl: "https://another-blog.example/harbor-form",
        sourceType: "independent",
        reputable: false,
      }),
    ]);

    expect(result.confidence).toBe("medium");
  });

  it("caps an unfetched search snippet at medium confidence", () => {
    const result = evaluateFoundingFact("city", [
      claim({ sourceType: "search-snippet", sourceText: null }),
    ]);

    expect(result.value).toBe("taipei");
    expect(result.confidence).toBe("medium");
    expect(acceptedFoundingFactValue(result)).toBeNull();
  });

  it("rejects headquarters, stores, studios, and current locations as founding-city evidence", () => {
    for (const locationContext of [
      "headquarters",
      "store",
      "studio",
      "current",
    ] as const) {
      const result = evaluateFoundingFact("city", [claim({ locationContext })]);
      expect(result.value, locationContext).toBeNull();
      expect(result.confidence, locationContext).toBe("none");
    }
  });

  it("rejects excerpts that are not present in fetched source text", () => {
    const result = evaluateFoundingFact("city", [
      claim({ sourceText: "A different sentence." }),
    ]);

    expect(result.value).toBeNull();
    expect(result.rejections).toContain("excerpt-not-found");
  });

  it("rejects invalid city slugs and future founding years", () => {
    expect(
      evaluateFoundingFact("city", [claim({ value: "tokyo" })]).value,
    ).toBeNull();
    expect(
      evaluateFoundingFact(
        "founding_year",
        [claim({ field: "founding_year", value: 2027 })],
        2026,
      ).value,
    ).toBeNull();
  });

  it("downgrades conflicting verified values for review", () => {
    const result = evaluateFoundingFact("city", [
      claim(),
      claim({
        value: "tainan",
        citedUrl: "https://local-news.example/harbor-form",
        sourceType: "independent",
        exactExcerpt: "Harbor Form was founded in Tainan in 2019.",
        sourceText: "Harbor Form was founded in Tainan in 2019.",
      }),
    ]);

    expect(result.confidence).toBe("medium");
    expect(result.conflicts).toEqual(["tainan"]);
  });

  it("keeps a high-confidence evidence hash stable when replaying accepted evidence", () => {
    const evaluated = evaluateFoundingFact("city", [
      claim(),
      claim({ verification: { passed: false, reason: "unsupported" } }),
    ]);

    const replayed = evaluateFoundingFact("city", evaluated.evidence);

    expect(evaluated.confidence).toBe("high");
    expect(evaluated.rejections).toContain("verification-failed");
    expect(replayed.evidenceHash).toBe(evaluated.evidenceHash);
  });
});

describe("deriveFoundingFactAction", () => {
  it("fills or corrects only high-confidence writable proposals", () => {
    const evaluated = evaluateFoundingFact("city", [claim()]);

    expect(deriveFoundingFactAction(evaluated, null, null)).toBe("fill");
    expect(deriveFoundingFactAction(evaluated, "tainan", null)).toBe("correct");
    expect(deriveFoundingFactAction(evaluated, "taipei", null)).toBe("verify");
  });

  it("routes owner and attributed-admin conflicts to review", () => {
    const evaluated = evaluateFoundingFact("city", [claim()]);

    expect(
      deriveFoundingFactAction(evaluated, "tainan", "protected:owner"),
    ).toBe("review");
    expect(
      deriveFoundingFactAction(evaluated, "tainan", "protected:admin"),
    ).toBe("review");
  });

  it("never clears an existing value when evidence is absent", () => {
    const evaluated = evaluateFoundingFact("city", []);

    expect(deriveFoundingFactAction(evaluated, "taipei", null)).toBe("review");
    expect(deriveFoundingFactAction(evaluated, null, null)).toBe("unresolved");
  });
});
