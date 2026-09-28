import { describe, expect, it } from "vitest";
import {
  detectProbes,
  detectResults,
  matchOwnership,
} from "../detect-evidence";
import { MAX_PROBE_URLS } from "../../category-classifier";
import type { BrandSearchEntry } from "../scraper/types";

describe("matchOwnership", () => {
  it.each([
    {
      name: "own_domain_is_site",
      link: "https://www.brand.tw/about",
      owned: ["https://brand.tw"],
      handle: null,
      expected: "site",
    },
    {
      name: "subdomain_is_site",
      link: "https://shop.brand.tw/items",
      owned: ["https://brand.tw"],
      handle: null,
      expected: "site",
    },
    {
      name: "shared_host_own_path_is_site",
      link: "https://www.pinkoi.com/store/brandx/p/1",
      owned: ["https://www.pinkoi.com/store/brandx"],
      handle: null,
      expected: "site",
    },
    {
      name: "shared_host_other_store_is_null",
      link: "https://www.pinkoi.com/store/other",
      owned: ["https://www.pinkoi.com/store/brandx"],
      handle: null,
      expected: null,
    },
    {
      name: "shared_host_prefix_is_not_a_path_segment_match",
      link: "https://www.pinkoi.com/store/brandx2",
      owned: ["https://www.pinkoi.com/store/brandx/"],
      handle: null,
      expected: null,
    },
    {
      name: "shared_host_root_owned_never_matches_everything",
      link: "https://shopee.tw/anyone",
      owned: ["https://shopee.tw/"],
      handle: null,
      expected: null,
    },
    {
      name: "ig_handle_match",
      link: "https://www.instagram.com/brandx/",
      owned: [],
      handle: "brandx",
      expected: "instagram",
    },
    {
      name: "ig_other_handle_is_null",
      link: "https://www.instagram.com/brandx/",
      owned: ["https://www.instagram.com/"],
      handle: "someoneelse",
      expected: null,
    },
    {
      name: "malformed_url_is_null",
      link: "not a url",
      owned: ["https://brand.tw"],
      handle: "brandx",
      expected: null,
    },
    {
      name: "unrelated_host_is_null",
      link: "https://notbrand.tw/",
      owned: ["https://brand.tw"],
      handle: null,
      expected: null,
    },
  ])("$name", ({ link, owned, handle, expected }) => {
    expect(matchOwnership(link, owned, handle)).toBe(expected);
  });

  it("malformed owned url does not throw", () => {
    expect(() =>
      matchOwnership("https://brand.tw", ["::::"], null),
    ).not.toThrow();
  });
});

describe("detectResults", () => {
  it("results_dedupe_and_skip_empty_titles", () => {
    const entries: BrandSearchEntry[] = [
      { title: "Brand X", link: "https://brand.tw/?utm_source=a", snippet: "first" },
      { title: "Brand X dup", link: "https://brand.tw/?utm_source=b&utm_medium=c", snippet: "second" },
      { title: "   ", link: "https://empty.tw/" },
      { title: "IG", link: "https://www.instagram.com/brandx/" },
      ...Array.from({ length: 12 }, (_, i) => ({
        title: `Other ${i}`,
        link: `https://other${i}.tw/page`,
      })),
    ];

    const lines = detectResults(entries, ["https://brand.tw"], "brandx");

    expect(lines).toHaveLength(10);
    expect(lines[0]).toEqual({
      title: "Brand X",
      snippet: "first",
      host: "brand.tw",
      match: "site",
    });
    expect(lines[1]).toEqual({ title: "IG", host: "instagram.com", match: "instagram" });
    expect(lines[2]).toEqual({ title: "Other 0", host: "other0.tw", match: null });
    expect(lines.some((line) => line.title === "Brand X dup")).toBe(false);
    expect(lines.some((line) => line.host === "empty.tw")).toBe(false);
  });

  it("keeps distinct non-tracking query strings apart", () => {
    const lines = detectResults(
      [
        { title: "A", link: "https://shop.tw/p?id=1" },
        { title: "B", link: "https://shop.tw/p?id=2" },
      ],
      [],
      null,
    );
    expect(lines.map((line) => line.title)).toEqual(["A", "B"]);
  });
});

describe("detectProbes", () => {
  it("returns undefined for no evidence", () => {
    expect(detectProbes(undefined)).toBeUndefined();
    expect(detectProbes([])).toBeUndefined();
    expect(detectProbes([{ url: "http://127.0.0.1/" }])).toBeUndefined();
  });

  it("probes_keep_failed_drop_private", () => {
    const probes = detectProbes([
      { url: "https://gone.tw/", status: 404 },
      { url: "http://127.0.0.1/admin", title: "Local" },
      { url: "https://brand.tw/", title: "Brand", description: "desc" },
      { url: "https://a.tw/", description: "a" },
      { url: "https://b.tw/", title: "b" },
      { url: "https://c.tw/", title: "c" },
      { url: "https://d.tw/", title: "d" },
    ]);

    expect(probes).toHaveLength(MAX_PROBE_URLS);
    expect(probes?.some((probe) => probe.url.includes("127.0.0.1"))).toBe(false);
    expect(probes?.[0]?.url).toBe("https://brand.tw/");

    const failed = detectProbes([
      { url: "https://gone.tw/", status: 404 },
      { url: "https://brand.tw/", title: "Brand" },
    ]);
    expect(failed?.map((probe) => probe.url)).toEqual([
      "https://brand.tw/",
      "https://gone.tw/",
    ]);
    expect(failed?.[1]).toEqual({ url: "https://gone.tw/", status: 404 });
  });

  it("probes_carry_status_and_followers", () => {
    expect(
      detectProbes([
        {
          url: "https://www.instagram.com/brandx/",
          title: "Brand X",
          description: "bio",
          platform: "instagram",
          status: 200,
          instagramFollowers: 1234,
        },
      ]),
    ).toEqual([
      {
        url: "https://www.instagram.com/brandx/",
        title: "Brand X",
        description: "bio",
        platform: "instagram",
        status: 200,
        instagramFollowers: 1234,
      },
    ]);
  });
});
