import { describe, expect, it } from "vitest";
import { matchBrandNames } from "../brand-name-match";

const brands = [
  { id: "spring", slug: "spring-pool", name: "春池玻璃", romanizedName: "Spring Pool", heroImageUrl: null },
  { id: "journey", slug: "journey-of-sole", name: "走走", romanizedName: "Journey of Sole", heroImageUrl: null },
];
describe("brand-name discovery", () => {
  it.each(["春池", "春池玻璃杯", "  春池  "])("finds a brand for %s in either containment direction", (query) => {
    expect(matchBrandNames(brands, query).map(b => b.slug)).toEqual(["spring-pool"]);
  });
  it("matches romanized names across case, full-width letters and whitespace", () => {
    expect(matchBrandNames(brands, " ＪＯＵＲＮＥＹ　 OF  SOLE ").map(b => b.slug)).toEqual(["journey-of-sole"]);
  });
  it.each(["茶", "ab", "a 茶", "%%", "", "x".repeat(101)])("rejects underspecified or invalid query %s", query => {
    expect(matchBrandNames(brands, query)).toEqual([]);
  });
  it("ranks prefixes before internal matches, then shorter names, and caps at six", () => {
    const names = ["老春池", "春池玻璃", "春池", "春池玻璃工藝", "春池小杯", "春池大杯", "春池花瓶", "春池水杯"];
    const matches = matchBrandNames(names.map(name => ({ ...brands[0]!, id: name, name, romanizedName: null })), "春池");
    expect(matches).toHaveLength(6);
    expect(matches.at(0)?.name).toBe("春池");
    expect(matches.every(b => b.name.startsWith("春池"))).toBe(true);
  });
});
