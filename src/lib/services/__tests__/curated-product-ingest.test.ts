import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  prefillFromUrl,
  type PrefillFetchPage,
} from "../curated-product-ingest";

const PAGE_URL = "https://studio-kiln.example.com/products/pour-over-cup";

/** Read as a string so the fixture stays plain HTML a browser can also open. */
function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

/**
 * Fetch double passed as an argument, never a module mock:
 * `scripts/check-test-boundaries.mjs` forbids vi.mock of `@/lib/services/`, and
 * the ingest service takes its fetch as a dependency precisely so it can be
 * driven this way with no network.
 */
function stubFetch(name: string): {
  fetchPage: PrefillFetchPage;
  calls: string[];
} {
  const calls: string[] = [];
  const fetchPage: PrefillFetchPage = async (url: string) => {
    calls.push(url);
    return { text: fixture(name), status: 200, latencyMs: 1, error: null };
  };
  return { fetchPage, calls };
}

describe("prefillFromUrl", () => {
  it("jsonld_product_wins_over_og", async () => {
    const { fetchPage, calls } = stubFetch("product-jsonld.html");

    const prefill = await prefillFromUrl(PAGE_URL, { fetchPage });

    expect(calls).toEqual([PAGE_URL]);
    // Escaped rather than literal so this source file stays ASCII-only; the
    // same characters appear verbatim in the HTML fixture.
    expect(prefill.nameZh).toBe("\u9676\u74F7\u624B\u6C96\u676F");
    expect(prefill.nameEn).toBe("Ceramic Pour-Over Cup");
    expect(prefill.description).toBe(
      "Hand-thrown stoneware cup fired at 1250C.",
    );
    expect(prefill.imageUrl).toBe(
      "https://cdn.example.com/media/jsonld-product.jpg",
    );
  });

  it("never reads price, availability, or offers from the Product node", async () => {
    const { fetchPage } = stubFetch("product-jsonld.html");

    const prefill = await prefillFromUrl(PAGE_URL, { fetchPage });

    expect(Object.keys(prefill).sort()).toEqual([
      "description",
      "imageUrl",
      "nameEn",
      "nameZh",
    ]);
  });

  it("falls_back_to_opengraph", async () => {
    const { fetchPage } = stubFetch("product-og.html");

    const prefill = await prefillFromUrl(PAGE_URL, { fetchPage });

    expect(prefill.nameEn).toBe("Studio Kiln Everyday Mug");
    expect(prefill.nameZh).toBeUndefined();
    expect(prefill.description).toBe("A stackable mug for daily use.");
    expect(prefill.imageUrl).toBe("https://cdn.example.com/media/og-mug.jpg");
  });

  it("ignores_non_product_jsonld", async () => {
    const { fetchPage } = stubFetch("product-og.html");

    const prefill = await prefillFromUrl(PAGE_URL, { fetchPage });

    expect(prefill.nameEn).not.toBe("Studio Kiln Company Limited");
    expect(prefill.nameEn).not.toBe("Tableware Breadcrumb Entry");
  });

  it("falls_back_to_title_tag", async () => {
    const { fetchPage } = stubFetch("product-title-only.html");

    const prefill = await prefillFromUrl(PAGE_URL, { fetchPage });

    expect(prefill.nameEn).toBe("Handmade Linen Apron");
    expect(prefill.description).toBeUndefined();
    expect(prefill.imageUrl).toBeUndefined();
  });

  it("returns_empty_prefill_for_bare_page", async () => {
    const { fetchPage } = stubFetch("product-bare.html");

    const prefill = await prefillFromUrl(PAGE_URL, { fetchPage });

    expect(prefill).toEqual({});
  });

  it("returns an empty prefill when the fetch fails", async () => {
    const fetchPage: PrefillFetchPage = async () => ({
      text: null,
      status: 503,
      latencyMs: 4,
      error: "http 503",
    });

    await expect(prefillFromUrl(PAGE_URL, { fetchPage })).resolves.toEqual({});
  });

  it("never_writes_to_database", async () => {
    // Two proofs, because one alone is weak. First: the behavioural one — the
    // only injected seam is the fetch, so a run that completes without touching
    // any other collaborator cannot have written anything.
    const { fetchPage, calls } = stubFetch("product-jsonld.html");
    await prefillFromUrl(PAGE_URL, { fetchPage });
    expect(calls).toHaveLength(1);

    // Second: the structural one. The service must hold no database client at
    // all — a write added later would need an import this assertion forbids.
    // `scripts/check-test-boundaries.mjs` bans mocking `@/lib/supabase/`, so a
    // never-called client double is not available to assert against instead.
    const source = readFileSync(
      new URL("../curated-product-ingest.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(/@\/lib\/supabase\//);
    expect(source).not.toMatch(/createServiceClient|createServerClient/);
    expect(source).not.toMatch(/\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
  });
});
