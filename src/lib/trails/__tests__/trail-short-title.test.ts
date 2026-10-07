import { describe, expect, it } from "vitest";

import { trailShortTitle } from "../trail-short-title";

describe("trailShortTitle", () => {
  it("keeps the text before a full-width colon", () => {
    expect(trailShortTitle("書桌：每天坐下來的那張桌子")).toBe("書桌");
    expect(trailShortTitle("每天出門的包：從包本身到掛在外面的小東西")).toBe(
      "每天出門的包",
    );
  });

  it("keeps the text before an ASCII colon, trimmed", () => {
    expect(trailShortTitle("Desk setup: the table")).toBe("Desk setup");
  });

  it("splits at the first colon of either width", () => {
    expect(trailShortTitle("A: b：c")).toBe("A");
    expect(trailShortTitle("甲：乙: 丙")).toBe("甲");
  });

  it("returns the trimmed title when there is no colon", () => {
    expect(trailShortTitle("  書桌  ")).toBe("書桌");
  });
});
