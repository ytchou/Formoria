import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

import {
  BANNED_TERMS,
  SHIELDS,
  collectViolations,
  formatViolations,
  isScannedSourceFile,
  scanJsonValue,
  scanSourceFile,
  scanText,
} from "./check-zh-terms.mjs";

// Fixtures come from the data, never from a literal pasted into this file: a
// hardcoded copy would keep passing after the term left banned-terms.json.
const [banned] = BANNED_TERMS;
// The one correct zh-TW word that contains a banned term as a substring.
const [shield] = SHIELDS;

describe("check-zh-terms — message catalogues", () => {
  it("flags a banned term in a message catalogue", () => {
    const violations = scanJsonValue(
      { brands: { filters: { appliedHint: banned.term } } },
      "messages/zh-TW.json",
    );

    expect(violations).toHaveLength(1);
    expect(violations[0].term).toBe(banned.term);
    expect(violations[0].replacement).toBe(banned.replacement);
  });

  it("reports the key path, not the line number", () => {
    const violations = scanJsonValue(
      { brands: { filters: { appliedHint: banned.term } } },
      "messages/zh-TW.json",
    );

    expect(violations[0].location).toBe("brands.filters.appliedHint");
    expect(Object.keys(violations[0])).not.toContain("line");
  });

  it("passes the current messages/zh-TW.json", () => {
    const catalogue = JSON.parse(readFileSync("messages/zh-TW.json", "utf8"));

    expect(scanJsonValue(catalogue, "messages/zh-TW.json")).toEqual([]);
  });
});

describe("check-zh-terms — prose", () => {
  it("passes on the shielded word that contains a banned substring", () => {
    expect(shield).toBeTruthy();
    expect(scanText(shield, "content/fixture.mdx")).toEqual([]);
  });

  it("reports a line number for prose files", () => {
    const violations = scanText(`x\n${banned.term}`, "content/fixture.mdx");

    expect(violations).toHaveLength(1);
    expect(violations[0].location).toBe("2");
  });
});

describe("check-zh-terms — source scope", () => {
  it("ignores non-user-facing paths", () => {
    // src/lib/prompts.ts is full of banned terms on purpose: they are the
    // instructions telling the model which words to avoid.
    expect(isScannedSourceFile("src/lib/prompts.ts")).toBe(false);
    expect(scanSourceFile("src/lib/prompts.ts")).toEqual([]);
  });

  it("scans the taxonomy ontology, whose nameZh values are public labels", () => {
    expect(isScannedSourceFile("src/lib/taxonomy/ontology.ts")).toBe(true);
  });
});

describe("check-zh-terms — repository gate", () => {
  it("finds no violations in the repository as it stands", () => {
    expect(formatViolations(collectViolations())).toBe("");
  });
});
