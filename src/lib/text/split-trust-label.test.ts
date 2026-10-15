import { describe, expect, it } from "vitest";
import { splitTrustLabel } from "./split-trust-label";

describe("splitTrustLabel", () => {
  it("splits zh-TW copy on the full-width colon", () => {
    expect(
      splitTrustLabel("收錄品牌：符合收錄規則、通過審核的品牌。不代表推薦、認證或排名。"),
    ).toEqual({
      term: "收錄品牌",
      description: "符合收錄規則、通過審核的品牌。不代表推薦、認證或排名。",
    });
  });

  it("splits English copy on the spaced em dash", () => {
    expect(
      splitTrustLabel("Sponsored — paid or commercial content, clearly labeled."),
    ).toEqual({
      term: "Sponsored",
      description: "paid or commercial content, clearly labeled.",
    });
  });

  it("splits on whichever separator comes first", () => {
    expect(splitTrustLabel("A：b — c")).toEqual({ term: "A", description: "b — c" });
    expect(splitTrustLabel("A — b：c")).toEqual({ term: "A", description: "b：c" });
  });

  it("returns a null description when there is no separator", () => {
    expect(splitTrustLabel("Formoria Selection")).toEqual({
      term: "Formoria Selection",
      description: null,
    });
  });
});
