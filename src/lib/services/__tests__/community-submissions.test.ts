import { describe, expect, it, vi } from "vitest";
import {
  executeCommunitySubmissions,
  normalizeCommunityWebsite,
  parseCommunitySubmissionsCsv,
  previewCommunitySubmissions,
  type CommunitySubmissionDependencies,
  type CommunitySubmissionDraft,
} from "../community-submissions";

function draft(
  id: string,
  name: string,
  website: string,
): CommunitySubmissionDraft {
  return { id, name, website };
}

function dependencies(
  existing: CommunitySubmissionDependencies["repository"]["loadExistingRecords"] extends (
    ...args: never[]
  ) => Promise<infer T>
    ? T
    : never = {
    catalog: [],
    submissions: [],
    similar: [],
  },
): CommunitySubmissionDependencies {
  return {
    repository: {
      loadExistingRecords: vi.fn().mockResolvedValue(existing),
    },
    submit: vi.fn().mockResolvedValue({ submissionId: "submission-1" }),
    buildGuestEmail: vi.fn(() => "guest+test@guest.formoria.invalid"),
  };
}

describe("community submission CSV parsing", () => {
  it("supports a BOM, quoted commas, escaped quotes, blank lines, and website normalization", () => {
    const rows = parseCommunitySubmissionsCsv(
      '\uFEFFname,website\r\n"Brand, One",brand.test\r\n\r\n"Brand ""Two""",https://two.test/path/\r\n',
      (() => {
        let id = 0;
        return () => `row-${++id}`;
      })(),
    );

    expect(rows).toEqual([
      { id: "row-1", name: "Brand, One", website: "https://brand.test" },
      { id: "row-2", name: 'Brand "Two"', website: "https://two.test/path" },
    ]);
  });

  it.each([
    ["brand,website\nA,a.test", "CSV header must be exactly name,website"],
    [
      "name,website,notes\nA,a.test,x",
      "CSV header must be exactly name,website",
    ],
    ['name,website\n"A,a.test', "CSV contains an unclosed quoted field"],
    [
      "name,website\nA,a.test,extra",
      "CSV row 2 must contain exactly two columns",
    ],
  ])("rejects malformed CSV", (csv, message) => {
    expect(() => parseCommunitySubmissionsCsv(csv)).toThrow(message);
  });

  it("ignores fully blank rows and enforces the 100-row limit", () => {
    expect(parseCommunitySubmissionsCsv("name,website\n,\n\n")).toEqual([]);
    const body = Array.from(
      { length: 101 },
      (_, index) => `Brand ${index},brand${index}.test`,
    ).join("\n");
    expect(() => parseCommunitySubmissionsCsv(`name,website\n${body}`)).toThrow(
      "CSV cannot contain more than 100 entries",
    );
  });

  it("normalizes equivalent official website forms", () => {
    expect(
      normalizeCommunityWebsite("WWW.Example.com:443/path/?campaign=1#top"),
    ).toEqual({
      url: "https://www.example.com/path",
      key: "example.com/path",
    });
    expect(normalizeCommunityWebsite("ftp://example.com")).toBeNull();
  });
});

describe("community submission preview", () => {
  it("classifies validation, batch, catalog, and pending-submission duplicates", async () => {
    const deps = dependencies({
      catalog: [{ name: "Catalog Brand", website: "https://catalog.test" }],
      submissions: [
        {
          name: "Pending Brand",
          website: "https://pending.test",
          status: "pending",
        },
        {
          name: "Approved Submission",
          website: "https://approved-submission.test",
          status: "approved",
        },
      ],
      similar: [],
    });
    const result = await previewCommunitySubmissions(
      [
        draft("invalid", "", "not a url"),
        draft("batch-a", "Batch Brand", "batch.test"),
        draft("batch-b", " batch  brand ", "other.test"),
        draft("catalog", "Different", "www.catalog.test/"),
        draft("pending", "PENDING BRAND", "elsewhere.test"),
        draft("approved", "Other", "approved-submission.test"),
        draft("ready", "Ready Brand", "ready.test"),
      ],
      deps,
    );

    expect(result.map(({ id, status }) => ({ id, status }))).toEqual([
      { id: "invalid", status: "invalid" },
      { id: "batch-a", status: "duplicate" },
      { id: "batch-b", status: "duplicate" },
      { id: "catalog", status: "duplicate" },
      { id: "pending", status: "duplicate" },
      { id: "approved", status: "duplicate" },
      { id: "ready", status: "ready" },
    ]);
  });

  it("does not query duplicate sources when every row is invalid", async () => {
    const deps = dependencies();

    await expect(
      previewCommunitySubmissions([draft("invalid", "", "")], deps),
    ).resolves.toMatchObject([{ id: "invalid", status: "invalid" }]);
    expect(deps.repository.loadExistingRecords).not.toHaveBeenCalled();
  });

  it("leaves fuzzy catalog matches as an overrideable warning", async () => {
    const deps = dependencies({
      catalog: [],
      submissions: [],
      similar: [
        {
          inputName: "Acme",
          brandName: "Acme Studio",
          brandSlug: "acme-studio",
          score: 0.82,
        },
      ],
    });

    await expect(
      previewCommunitySubmissions([draft("a", "Acme", "acme.test")], deps),
    ).resolves.toMatchObject([
      {
        id: "a",
        status: "similar",
        normalizedWebsite: "https://acme.test",
        similarBrands: [
          { name: "Acme Studio", slug: "acme-studio", score: 0.82 },
        ],
      },
    ]);
  });
});

describe("community submission execution", () => {
  it("revalidates, preserves order, and isolates duplicates, validation errors, and database failures", async () => {
    const deps = dependencies({
      catalog: [{ name: "Existing", website: "https://existing.test" }],
      submissions: [],
      similar: [],
    });
    vi.mocked(deps.submit)
      .mockResolvedValueOnce({ submissionId: "created-a" })
      .mockRejectedValueOnce(new Error("database unavailable"));

    const rows = await executeCommunitySubmissions(
      [
        draft("a", "Alpha", "alpha.test"),
        draft("duplicate", "Existing", "new.test"),
        draft("invalid", "", "invalid"),
        draft("b", "Beta", "beta.test"),
      ],
      deps,
    );

    expect(deps.repository.loadExistingRecords).toHaveBeenCalledTimes(1);
    expect(rows).toEqual([
      { id: "a", status: "created", submissionId: "created-a" },
      {
        id: "duplicate",
        status: "skipped_duplicate",
        message: expect.any(String),
      },
      { id: "invalid", status: "failed", message: expect.any(String) },
      { id: "b", status: "failed", message: "database unavailable" },
    ]);
    expect(deps.submit).toHaveBeenCalledTimes(2);
    expect(deps.submit).toHaveBeenNthCalledWith(1, {
      intent: "recommend",
      brandName: "Alpha",
      websiteUrl: "https://alpha.test",
      submitterEmail: "guest+test@guest.formoria.invalid",
      isBrandOwner: false,
      pdpaConsent: false,
      sourceAttribution: "found_online",
    });
  });

  it("bounds independent writes at concurrency five", async () => {
    let active = 0;
    let peak = 0;
    const deps = dependencies();
    vi.mocked(deps.submit).mockImplementation(async ({ brandName }) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return { submissionId: brandName };
    });
    const rows = Array.from({ length: 12 }, (_, index) =>
      draft(String(index), `Brand ${index}`, `brand-${index}.test`),
    );

    await executeCommunitySubmissions(rows, deps);

    expect(peak).toBe(5);
  });
});
