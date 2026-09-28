import { describe, expect, it } from "vitest";
import {
  detectProbes,
  detectResultLines,
  hasHeadText,
  matchOwnership,
} from "../detect-evidence";
import { MAX_PROBE_URLS } from "@/lib/prompts/detect-message";
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
      name: "shared_host_query_owned_same_id_is_site",
      link: "https://www.facebook.com/profile.php?id=100&ref=share",
      owned: ["https://www.facebook.com/profile.php?id=100"],
      handle: null,
      expected: "site",
    },
    {
      name: "shared_host_query_owned_other_id_is_null",
      link: "https://www.facebook.com/profile.php?id=999",
      owned: ["https://www.facebook.com/profile.php?id=100"],
      handle: null,
      expected: null,
    },
    {
      name: "shared_host_query_owned_missing_id_is_null",
      link: "https://www.facebook.com/profile.php",
      owned: ["https://www.facebook.com/profile.php?id=100"],
      handle: null,
      expected: null,
    },
    {
      name: "shared_host_owned_tracking_params_ignored",
      link: "https://www.facebook.com/profile.php?id=100",
      owned: ["https://www.facebook.com/profile.php?id=100&utm_source=ig"],
      handle: null,
      expected: "site",
    },
    {
      name: "shared_host_brand_subdomain_is_site",
      link: "https://brand.pixnet.net/blog/post/1",
      owned: ["https://brand.pixnet.net"],
      handle: null,
      expected: "site",
    },
    {
      name: "shared_host_other_subdomain_is_null",
      link: "https://another.pixnet.net/blog/post/1",
      owned: ["https://brand.pixnet.net"],
      handle: null,
      expected: null,
    },
    {
      name: "shared_host_apex_owned_never_matches_subdomains",
      link: "https://another.pixnet.net/blog/post/1",
      owned: ["https://www.pixnet.net/"],
      handle: null,
      expected: null,
    },
    {
      name: "one_segment_owned_path_grants_whole_host",
      link: "https://brand.tw/about",
      owned: ["https://brand.tw/zh-tw"],
      handle: null,
      expected: "site",
    },
    {
      name: "one_segment_file_owned_path_grants_whole_host",
      link: "https://brand.tw/about",
      owned: ["https://brand.tw/index.html"],
      handle: null,
      expected: "site",
    },
    {
      name: "root_owned_subdomain_link_is_site",
      link: "https://shop.brand.tw/x",
      owned: ["https://brand.tw/"],
      handle: null,
      expected: "site",
    },
    {
      name: "deep_owned_path_other_page_is_null",
      link: "https://someblog.com/other",
      owned: ["https://someblog.com/post/123"],
      handle: null,
      expected: null,
    },
    {
      name: "deep_owned_path_same_page_is_site",
      link: "https://SomeBlog.com/Post/123/",
      owned: ["https://someblog.com/post/123"],
      handle: null,
      expected: "site",
    },
    {
      name: "deep_owned_path_child_page_is_site",
      link: "https://someblog.com/post/123/p2",
      owned: ["https://someblog.com/post/123"],
      handle: null,
      expected: "site",
    },
    {
      name: "deep_owned_path_prefix_is_not_a_segment_match",
      link: "https://someblog.com/post/1234",
      owned: ["https://someblog.com/post/123"],
      handle: null,
      expected: null,
    },
    {
      name: "deep_owned_path_other_root_owned_url_grants_host",
      link: "https://someblog.com/other",
      owned: ["https://someblog.com/post/123", "https://someblog.com"],
      handle: null,
      expected: "site",
    },
    {
      name: "shared_host_common_subdomain_root_owned_is_null",
      link: "https://m.facebook.com/other",
      owned: ["https://m.facebook.com/"],
      handle: null,
      expected: null,
    },
    {
      name: "shared_host_platform_subdomain_root_owned_is_null",
      link: "https://maps.google.com/other",
      owned: ["https://maps.google.com/"],
      handle: null,
      expected: null,
    },
    {
      name: "shared_host_publishing_www_root_owned_is_null",
      link: "https://www.blogspot.com/other",
      owned: ["https://www.blogspot.com/"],
      handle: null,
      expected: null,
    },
    {
      name: "shared_host_blogspot_brand_subdomain_is_site",
      link: "https://brand.blogspot.com/2024/01/post.html",
      owned: ["https://brand.blogspot.com/"],
      handle: null,
      expected: "site",
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

describe("detectResultLines", () => {
  it("results_dedupe_and_skip_empty_entries", () => {
    const entries: BrandSearchEntry[] = [
      { title: "Brand X", link: "https://brand.tw/?utm_source=a", snippet: "first" },
      { title: "Brand X dup", link: "https://brand.tw/?utm_source=b&utm_medium=c", snippet: "second" },
      { title: "   ", link: "https://empty.tw/", snippet: "  " },
      { title: "IG", link: "https://www.instagram.com/brandx/" },
      ...Array.from({ length: 12 }, (_, i) => ({
        title: `Other ${i}`,
        link: `https://other${i}.tw/page`,
      })),
    ];

    const lines = detectResultLines(entries, ["https://brand.tw"], "brandx");

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
    const lines = detectResultLines(
      [
        { title: "A", link: "https://shop.tw/p?id=1" },
        { title: "B", link: "https://shop.tw/p?id=2" },
      ],
      [],
      null,
    );
    expect(lines.map((line) => line.title)).toEqual(["A", "B"]);
  });

  it("keeps a snippet-only entry with an empty title", () => {
    const lines = detectResultLines(
      [{ title: "", link: "https://www.news.tw/a", snippet: "Brand X opens" }],
      [],
      null,
    );
    expect(lines).toEqual([
      { title: "", snippet: "Brand X opens", host: "news.tw", match: null },
    ]);
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

  it("drops a reachable probe with no head text", () => {
    // An SPA shell answers 200 with an empty <title>: that is not an
    // unreachable site, and it carries no evidence either.
    expect(
      detectProbes([
        { url: "https://spa.tw/", status: 200 },
        { url: "https://moved.tw/", status: 301, title: "  " },
      ]),
    ).toBeUndefined();

    expect(
      detectProbes([
        { url: "https://spa.tw/", status: 200 },
        { url: "https://gone.tw/", status: 500 },
        { url: "https://timeout.tw/" },
      ])?.map((probe) => probe.url),
    ).toEqual(["https://gone.tw/", "https://timeout.tw/"]);
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

describe("hasHeadText", () => {
  it("needs a non-blank title or description", () => {
    expect(hasHeadText({ title: "A" })).toBe(true);
    expect(hasHeadText({ description: "d" })).toBe(true);
    expect(hasHeadText({ title: " ", description: "" })).toBe(false);
  });
});
