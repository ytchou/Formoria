import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EnrichBrand, EnrichPhase } from "../types";
import { runAcquirePhase } from "../acquire";
import { emptyResult } from "../scraper/parse/extractors";
import type {
  CatalogDiscoveryResult,
  DiscoverCatalogOptions,
} from "../catalog-discovery";

/**
 * Catalog discovery in the acquire phase.
 *
 * These cases used to target `runBrandImagePhase`: catalog discovery moved out
 * of products into the images phase (DEV-1633), and DEV-1644 PR 4 moved it again
 * into the acquisition agent, which is the only phase still scheduled. The
 * phase's remaining job is to hand the agent the brand's channel sources and the
 * discovery function, and to carry `catalogResult` / `acquisitionPageUrls` back
 * out for the products agent — so that is what is asserted here.
 */

const scraperMocks = vi.hoisted(() => ({ scrapeBrandUrls: vi.fn() }));
const acquisitionMocks = vi.hoisted(() => ({ runAcquisition: vi.fn() }));

vi.mock("../scraper", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../scraper")>()),
  scrapeBrandUrls: scraperMocks.scrapeBrandUrls,
}));

vi.mock("../acquisition/graph", () => ({
  runAcquisition: acquisitionMocks.runAcquisition,
}));

const SITE = "https://island-studio.example";
const PINKOI = "https://pinkoi.com/store/island-studio";
const PHASES = ["acquire"] as EnrichPhase[];

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

const model = vi.fn(async () => ({ invoke: async () => ({ content: "{}" }) }));

function stubDiscoverCatalog(result: CatalogDiscoveryResult = EMPTY_CATALOG): {
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

const run = (
  overrides: Partial<Parameters<typeof runAcquirePhase>[0]> = {},
) =>
  runAcquirePhase({
    brand: BRAND,
    phases: PHASES,
    discoveredUrls: [],
    knownUrls: [SITE],
    dryRun: true,
    supabase: {} as never,
    ...overrides,
    deps: { createAgentModel: model, ...(overrides.deps ?? {}) },
  });

beforeEach(() => {
  scraperMocks.scrapeBrandUrls.mockReset();
  acquisitionMocks.runAcquisition.mockReset();
  vi.stubEnv("ACQUISITION_AGENT", "on");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response("", { status: 404 })),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("acquire phase catalog-discovery threading", () => {
  it("acquire_passes_channel_sources_to_the_agent", async () => {
    const { fn } = stubDiscoverCatalog();
    acquisitionMocks.runAcquisition.mockResolvedValue({
      agentOutcome: "planned",
      scrapeResult: { data: emptyResult(SITE), statuses: [] },
      decisions: [],
    });

    await run({ deps: { discoverCatalog: fn } });

    const deps = acquisitionMocks.runAcquisition.mock.calls[0]![1];
    expect(deps.discoverCatalog).toBe(fn);
    expect(deps.catalogSources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ url: SITE, channel: "official" }),
        expect.objectContaining({ url: PINKOI, channel: "pinkoi" }),
      ]),
    );
  });

  it("acquire_passes_empty_sources_when_the_brand_has_no_channels", async () => {
    const { fn } = stubDiscoverCatalog();
    acquisitionMocks.runAcquisition.mockResolvedValue({
      agentOutcome: "planned",
      scrapeResult: { data: emptyResult(SITE), statuses: [] },
      decisions: [],
    });

    await run({
      brand: {
        ...BRAND,
        purchase_website: undefined,
        purchase_pinkoi: undefined,
        purchase_shopee: undefined,
        purchase_myship: undefined,
      },
      deps: { discoverCatalog: fn },
    });

    expect(acquisitionMocks.runAcquisition.mock.calls[0]![1].catalogSources).toEqual([]);
  });

  it("acquire_returns_catalog_result_from_the_agent", async () => {
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
    acquisitionMocks.runAcquisition.mockResolvedValue({
      agentOutcome: "planned",
      scrapeResult: { data: emptyResult(SITE), statuses: [] },
      catalogResult,
      acquisitionPageUrls: [`${SITE}/products/plate`],
      decisions: [],
    });

    const output = await run();

    expect(output.catalogResult?.triples).toHaveLength(1);
    expect(output.catalogResult?.triples[0]!.url).toBe(`${SITE}/products/plate`);
    expect(output.catalogResult?.attempts).toHaveLength(1);
    expect(output.acquisitionPageUrls).toEqual([`${SITE}/products/plate`]);
  });

  it("acquire_defaults_catalog_and_page_urls_when_the_agent_found_none", async () => {
    acquisitionMocks.runAcquisition.mockResolvedValue({
      agentOutcome: "planned",
      scrapeResult: { data: emptyResult(SITE), statuses: [] },
      decisions: [],
    });

    const output = await run();

    expect(output.catalogResult).toBeUndefined();
    expect(output.acquisitionPageUrls).toEqual([]);
    expect(output.imagePool).toEqual([]);
  });

  it("skipped phase returns the empty catalog defaults", async () => {
    const output = await run({ phases: ["descriptions"] as EnrichPhase[] });

    expect(output.phaseResult.status).toBe("skipped");
    expect(acquisitionMocks.runAcquisition).not.toHaveBeenCalled();
    expect(output.catalogResult).toBeUndefined();
    expect(output.acquisitionPageUrls).toEqual([]);
    expect(output.revokedColumns).toEqual([]);
    expect(output.providerFailure).toBe(false);
  });
});
