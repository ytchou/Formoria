import { describe, expect, it } from "vitest";
import {
  asciiHead,
  brandSlugFromUrl,
  findSuccessor,
  normalizeForMatch,
  parseGscExport,
  triage,
  type BrandRow,
  type SlugRedirectRow,
} from "./gsc-404-triage";

const brands: BrandRow[] = [
  { slug: "seasons-bikini", name: "Seasons Bikini", status: "approved" },
  { slug: "keizu", name: "Keizu 凱茲好鞋", status: "approved" },
  { slug: "halfor", name: "HALFÔR", status: "approved" },
  { slug: "gamakuchi", name: "京都奈口金包 Gamakuchi", status: "approved" },
  { slug: "kom", name: "KOM", status: "approved" },
  { slug: "colorsmith", name: "COLORSMITH", status: "hidden" },
  { slug: "tri-aid", name: "Tri-Aid", status: "hidden" },
  { slug: "兔寶森林床店", name: "兔寶森林床店", status: "approved" },
];

const redirects: SlugRedirectRow[] = [
  { old_slug: "home-desyne-臺灣捷安傢飾", new_slug: "home-desyne" },
];

function rows(...urls: string[]) {
  return urls.map((url) => ({ url, lastCrawled: "2026-08-05" }));
}

describe("parseGscExport", () => {
  it("reads the URL and last-crawled columns", () => {
    const csv =
      "URL,Last crawled\nhttps://formoria.com/brands/kom,2026-08-05\n";
    expect(parseGscExport(csv)).toEqual([
      { url: "https://formoria.com/brands/kom", lastCrawled: "2026-08-05" },
    ]);
  });

  it("rejects an export without a URL column rather than returning nothing", () => {
    expect(() => parseGscExport("Page,Clicks\n/a,1\n")).toThrow(/URL/);
  });

  // Regression: slugs derived from scraped page titles carry a literal newline,
  // and splitting on \n before honouring quotes reports two broken URLs where
  // Search Console reported one real 404.
  it("keeps a quoted URL containing a newline as a single record", () => {
    const csv =
      "URL,Last crawled\n" +
      '"https://formoria.com/brands/56 Posts - See Instagram photos and videos from \n植茁 (@singhi_2022)",2026-07-31\n' +
      "https://formoria.com/brands/kom,2026-08-05\n";

    const parsed = parseGscExport(csv);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.url).toContain("56 Posts");
    expect(parsed[0]?.url).toContain("(@singhi_2022)");
    expect(parsed[0]?.url).not.toContain("\n");
    expect(parsed[0]?.lastCrawled).toBe("2026-07-31");
  });

  it("handles CRLF exports", () => {
    expect(
      parseGscExport(
        "URL,Last crawled\r\nhttps://formoria.com/brands/kom,2026-08-05\r\n",
      ),
    ).toEqual([
      { url: "https://formoria.com/brands/kom", lastCrawled: "2026-08-05" },
    ]);
  });
});

describe("brandSlugFromUrl", () => {
  it("decodes percent-encoded CJK slugs", () => {
    expect(
      brandSlugFromUrl(
        "https://formoria.com/brands/%E5%85%94%E5%AF%B6%E6%A3%AE%E6%9E%97%E5%BA%8A%E5%BA%97",
      ),
    ).toBe("兔寶森林床店");
  });

  it("treats the /en twin as the same slug", () => {
    expect(brandSlugFromUrl("https://formoria.com/en/brands/kom")).toBe("kom");
  });

  it("returns null for non-brand paths", () => {
    expect(brandSlugFromUrl("https://formoria.com/categories/food")).toBeNull();
    expect(
      brandSlugFromUrl("https://formoria.com/brands/kom/reviews"),
    ).toBeNull();
  });
});

describe("normalizeForMatch", () => {
  // Regression: a range of [^a-z0-9] collapses every Chinese-only name to '',
  // every '' compares equal, and the matcher proposes a redirect from each dead
  // slug to an arbitrary brand.
  it("keeps CJK so Chinese-only names stay distinguishable", () => {
    expect(normalizeForMatch("兔寶森林床店")).toBe("兔寶森林床店");
    expect(normalizeForMatch("慢蔓皂屋")).not.toBe(
      normalizeForMatch("兔寶森林床店"),
    );
  });

  it("folds case and punctuation", () => {
    expect(normalizeForMatch("HALFÔR")).toBe(normalizeForMatch("half-r"));
  });
});

describe("asciiHead", () => {
  it("takes the leading ASCII run without a trailing separator", () => {
    expect(asciiHead("keizu-好鞋好設計")).toBe("keizu");
    expect(asciiHead("kom")).toBe("kom");
  });
});

describe("findSuccessor", () => {
  it("matches on a shared prefix", () => {
    expect(findSuccessor("seasons", brands)?.slug).toBe("seasons-bikini");
  });

  it("matches on the ASCII head of a CJK slug", () => {
    expect(findSuccessor("keizu-好鞋好設計", brands)?.slug).toBe("keizu");
  });

  it("matches on the normalized brand name", () => {
    expect(findSuccessor("京都奈口金包gamakuchi", brands)?.slug).toBe(
      "gamakuchi",
    );
  });

  // resolveApprovedBrandRedirect joins on status='approved', so a row pointing
  // at a hidden brand still serves a 404 while looking fixed.
  it("never proposes a hidden brand", () => {
    expect(findSuccessor("tri", brands)).toBeNull();
  });

  it("returns null when nothing plausible exists", () => {
    expect(findSuccessor("買床墊找大吳小姐", brands)).toBeNull();
  });
});

describe("triage", () => {
  it("groups the zh-TW and /en twins into one decision", () => {
    const result = triage(
      rows(
        "https://formoria.com/brands/seasons",
        "https://formoria.com/en/brands/seasons",
      ),
      brands,
      redirects,
    );
    expect(result.totalUrls).toBe(2);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.urls).toHaveLength(2);
  });

  it("separates recoverable renames from correct 404s", () => {
    const result = triage(
      rows(
        "https://formoria.com/brands/seasons",
        "https://formoria.com/brands/kom",
        "https://formoria.com/brands/colorsmith",
        "https://formoria.com/brands/home-desyne-%E8%87%BA%E7%81%A3%E6%8D%B7%E5%AE%89%E5%82%A2%E9%A3%BE",
        "https://formoria.com/brands/買床墊找大吳小姐",
        "https://formoria.com/categories/food",
      ),
      brands,
      redirects,
    );

    expect(result.summary).toEqual({
      "renamed-missing-redirect": 1,
      "redirect-exists": 1,
      "live-approved": 1,
      "live-hidden": 1,
      gone: 1,
      "non-brand": 1,
    });
    expect(result.entries[0]?.bucket).toBe("renamed-missing-redirect");
    expect(result.entries[0]?.successor?.slug).toBe("seasons-bikini");
  });
});
