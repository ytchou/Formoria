import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EnrichBrand, EnrichPhase } from "../types";
import { runBrandImagePhase } from "../images";
import type { CandidateImage } from "../candidate-pool";
import type {
  CatalogDiscoveryResult,
  DiscoverCatalogOptions,
} from "../catalog-discovery";

/**
 * Tests for the catalog-discovery integration in the images phase.
 * Catalog-discovery moved here from products (DEV-1633) so acquisition
 * is unified: the images phase discovers product pages and passes them
 * downstream via `catalogResult` and `acquisitionPageUrls`.
 */

const SITE = "https://island-studio.example";
const PINKOI = "https://pinkoi.com/store/island-studio";
const PHASES = ["images"] as EnrichPhase[];

const BRAND: EnrichBrand = {
  id: "3f7c1c4e-0b2a-4a9d-9a5a-2c8e1d4b6f01",
  slug: "island-studio",
  name: "island studio",
  category: "home",
  purchase_website: SITE,
  purchase_pinkoi: PINKOI,
};

const EMPTY_CATALOG: CatalogDiscoveryResult = {
  triples: [],
  attempts: [],
  evidence: new Map(),
};

function stubDiscoverCatalog(
  result: CatalogDiscoveryResult = EMPTY_CATALOG,
): {
  fn: (options: DiscoverCatalogOptions) => Promise<CatalogDiscoveryResult>;
  calls: DiscoverCatalogOptions[];
} {
  const calls: DiscoverCatalogOptions[] = [];
  const fn = async (
    options: DiscoverCatalogOptions,
  ): Promise<CatalogDiscoveryResult> => {
    calls.push(options);
    return result;
  };
  return { fn, calls };
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response("", { status: 404 })),
  );
});

describe("images phase catalog-discovery integration", () => {
  it("images_phase_returns_catalog_result", async () => {
    const catalogResult: CatalogDiscoveryResult = {
      triples: [
        {
          url: `${SITE}/products/plate`,
          title: "Plate",
          imageUrl: `${SITE}/img/plate.jpg`,
          platform: "generic",
          supplier: "catalog:generic",
          sourceUrl: SITE,
          sourcePosition: 0,
        },
      ],
      attempts: [
        {
          sourceUrl: SITE,
          platform: "generic",
          extractor: "generic",
          staticOutcome: "usable",
          renderOutcome: "not_requested",
          sitemapLocations: 0,
          rawUrls: 1,
          ownedDetailUrls: 1,
          completeTriples: 1,
          selected: 1,
          hydrated: 1,
          usable: 1,
          drops: {},
        },
      ],
      evidence: new Map([
        [
          `${SITE}/products/plate`,
          {
            title: "Plate",
            text: "A ceramic plate.",
            imageUrls: [`${SITE}/img/plate.jpg`],
          },
        ],
      ]),
    };
    const { fn } = stubDiscoverCatalog(catalogResult);

    const output = await runBrandImagePhase({
      brand: BRAND,
      phases: PHASES,
      imageSearchUrls: [`${SITE}/img/plate.jpg`],
      dryRun: true,
      discoverCatalog: fn,
    });

    expect(output.catalogResult).toBeDefined();
    expect(output.catalogResult.triples).toHaveLength(1);
    expect(output.catalogResult.triples[0]!.url).toBe(
      `${SITE}/products/plate`,
    );
    expect(output.catalogResult.attempts).toHaveLength(1);
  });

  it("images_phase_returns_acquisition_page_urls", async () => {
    const candidates: CandidateImage[] = [
      {
        url: `${SITE}/img/plate.jpg`,
        source: "scrape",
        pageUrl: `${SITE}/products/plate`,
      },
      {
        url: `${SITE}/img/cup.jpg`,
        source: "scrape",
        pageUrl: `${SITE}/products/cup`,
      },
      {
        url: `${SITE}/img/no-page.jpg`,
        source: "google_image",
        // no pageUrl
      },
    ];
    const { fn } = stubDiscoverCatalog();

    const output = await runBrandImagePhase({
      brand: BRAND,
      phases: PHASES,
      imageSearchUrls: [],
      candidateImages: candidates,
      dryRun: true,
      discoverCatalog: fn,
    });

    expect(output.acquisitionPageUrls).toEqual([
      `${SITE}/products/plate`,
      `${SITE}/products/cup`,
    ]);
  });

  it("images_phase_calls_catalog_discovery_with_channel_urls", async () => {
    const { fn, calls } = stubDiscoverCatalog();

    await runBrandImagePhase({
      brand: BRAND,
      phases: PHASES,
      imageSearchUrls: [`${SITE}/img/plate.jpg`],
      dryRun: true,
      discoverCatalog: fn,
    });

    expect(calls).toHaveLength(1);
    const sources = calls[0]!.sources;
    expect(sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ url: SITE, channel: "official" }),
        expect.objectContaining({ url: PINKOI, channel: "pinkoi" }),
      ]),
    );
  });

  it("images_phase_skips_catalog_when_no_channel_urls", async () => {
    const brandNoChannels: EnrichBrand = {
      ...BRAND,
      purchase_website: undefined,
      purchase_pinkoi: undefined,
      purchase_shopee: undefined,
      purchase_myship: undefined,
    };
    const { fn, calls } = stubDiscoverCatalog();

    const output = await runBrandImagePhase({
      brand: brandNoChannels,
      phases: PHASES,
      imageSearchUrls: [`${SITE}/img/plate.jpg`],
      dryRun: true,
      discoverCatalog: fn,
    });

    expect(calls).toHaveLength(0);
    expect(output.catalogResult).toEqual({
      triples: [],
      attempts: [],
      evidence: new Map(),
    });
    expect(output.acquisitionPageUrls).toEqual([]);
  });

  it("skipped phase returns empty catalog defaults", async () => {
    const { fn, calls } = stubDiscoverCatalog();

    const output = await runBrandImagePhase({
      brand: BRAND,
      phases: ["descriptions"] as EnrichPhase[],
      imageSearchUrls: [`${SITE}/img/plate.jpg`],
      discoverCatalog: fn,
    });

    expect(output.phaseResult.status).toBe("skipped");
    expect(calls).toHaveLength(0);
    expect(output.catalogResult).toEqual({
      triples: [],
      attempts: [],
      evidence: new Map(),
    });
    expect(output.acquisitionPageUrls).toEqual([]);
  });

  it("images_phase_forwards_entry_and_priority_urls_to_catalog", async () => {
    const entryUrls = [`${SITE}/collections/all`, `${SITE}/shop`];
    const priorityProductUrls = [`${SITE}/products/plate`, `${SITE}/products/cup`];
    const { fn, calls } = stubDiscoverCatalog();

    await runBrandImagePhase({
      brand: BRAND,
      phases: PHASES,
      imageSearchUrls: [`${SITE}/img/plate.jpg`],
      dryRun: true,
      discoverCatalog: fn,
      catalogEntryUrls: entryUrls,
      catalogPriorityProductUrls: priorityProductUrls,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.entryUrls).toEqual(entryUrls);
    expect(calls[0]!.priorityProductUrls).toEqual(priorityProductUrls);
  });

  it("images_phase_defaults_to_empty_arrays_when_plan_absent", async () => {
    const { fn, calls } = stubDiscoverCatalog();

    await runBrandImagePhase({
      brand: BRAND,
      phases: PHASES,
      imageSearchUrls: [`${SITE}/img/plate.jpg`],
      dryRun: true,
      discoverCatalog: fn,
      // No catalogEntryUrls or catalogPriorityProductUrls provided
    });

    expect(calls).toHaveLength(1);
    // When omitted, the fields should be undefined (pass-through as optional)
    expect(calls[0]!.entryUrls).toBeUndefined();
    expect(calls[0]!.priorityProductUrls).toBeUndefined();
  });

  it("empty candidates still runs catalog discovery", async () => {
    // Catalog discovery is about product pages, not images.
    // Even with zero image candidates, it should still run.
    const { fn, calls } = stubDiscoverCatalog();

    const output = await runBrandImagePhase({
      brand: BRAND,
      phases: PHASES,
      imageSearchUrls: [],
      candidateImages: [],
      dryRun: true,
      discoverCatalog: fn,
    });

    // The phase skips image processing but catalog must still run
    expect(calls).toHaveLength(1);
    expect(output.catalogResult).toBeDefined();
    expect(output.acquisitionPageUrls).toEqual([]);
  });
});
