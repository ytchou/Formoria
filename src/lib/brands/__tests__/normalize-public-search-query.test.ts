import { describe, expect, it } from "vitest";
import { normalizePublicSearchQuery } from "../normalize-public-search-query";

describe("normalizePublicSearchQuery", () => {
  // DEV-1991: one Han character is a complete Chinese query (茶, 陶, 襪), and
  // search_brand_page answers it through its short-CJK ILIKE arm.
  it.each([
    ["茶", "茶"],
    [" 喵 ", "喵"],
    ["喵島", "喵島"],
    ["陶瓷", "陶瓷"],
    ["ab", "ab"],
  ])("accepts %j as %j", (input, expected) => {
    expect(normalizePublicSearchQuery(input)).toBe(expected);
  });

  // A single Latin letter or digit stays below the floor: it would match most
  // of the catalog and the SQL guard rejects it too.
  it.each(["a", "Z", "7", " ", "", "%", "_*", "x".repeat(101)])(
    "rejects %j",
    (input) => {
      expect(normalizePublicSearchQuery(input)).toBeNull();
    },
  );
});
