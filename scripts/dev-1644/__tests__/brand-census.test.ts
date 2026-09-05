/**
 * Pure logic for the cohort before/after census.
 * No Supabase client — only the field statistics, the diff, and the guard that
 * refuses to point the census at production.
 */
import { describe, expect, it } from "vitest";

import {
  type CensusFile,
  type CensusRow,
  assertCensusTarget,
  countGallery,
  diffRow,
  emptyCensusRow,
  linkSourcesFromPhaseResults,
  renderCensusDiff,
  summarizeProductRows,
  textStat,
  type SubmissionCensusRow,
} from "../brand-census";

const STAGING_URL = "https://ttkkyvgvcamfoezsetvf.supabase.co";
const PRODUCTION_URL = "https://xkcayngbttpxyibgzern.supabase.co";

// ---------------------------------------------------------------------------
// Target guard — staging by default, production only when asked twice
// ---------------------------------------------------------------------------

describe("assertCensusTarget", () => {
  it("allows the staging project without a confirmation", () => {
    expect(() =>
      assertCensusTarget({
        supabaseUrl: STAGING_URL,
        target: "staging",
        confirmed: false,
      }),
    ).not.toThrow();
  });

  it("refuses the production project even when --target production is passed alone", () => {
    expect(() =>
      assertCensusTarget({
        supabaseUrl: PRODUCTION_URL,
        target: "production",
        confirmed: false,
      }),
    ).toThrow(/--confirm/);
  });

  it("refuses a production URL that arrived under a staging target", () => {
    expect(() =>
      assertCensusTarget({
        supabaseUrl: PRODUCTION_URL,
        target: "staging",
        confirmed: true,
      }),
    ).toThrow(/production/);
  });

  it("allows production only with both --target production and --confirm", () => {
    expect(() =>
      assertCensusTarget({
        supabaseUrl: PRODUCTION_URL,
        target: "production",
        confirmed: true,
      }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Per-field statistics
// ---------------------------------------------------------------------------

describe("textStat", () => {
  it("reports zero length and zero hits for a missing field", () => {
    expect(textStat(null, "zh")).toEqual({ length: 0, aiArtifactHits: 0 });
  });

  it("counts characters and AI artifact hits", () => {
    const stat = textStat("A pioneering brand with unparalleled craft.", "en");
    expect(stat.length).toBe(43);
    expect(stat.aiArtifactHits).toBe(2);
  });

  it("reports zero hits for prose the detector accepts", () => {
    expect(textStat("A leather workshop in Tainan, open since 2014.", "en").aiArtifactHits).toBe(0);
  });
});

describe("countGallery", () => {
  it("counts the gallery slots only — sort_order 1 through 9", () => {
    expect(
      countGallery([
        { sort_order: 0 },
        { sort_order: 1 },
        { sort_order: 9 },
        { sort_order: 10 },
      ]),
    ).toBe(2);
  });
});

describe("summarizeProductRows", () => {
  it("counts visible products and the three quality signals", () => {
    expect(
      summarizeProductRows([
        {
          visible: true,
          link_state: "ok",
          link_checked_at: "2026-09-01T00:00:00Z",
          made_in_taiwan_confirmed: true,
          image_url: "https://cdn/x.jpg",
        },
        {
          visible: true,
          link_state: "unchecked",
          link_checked_at: null,
          made_in_taiwan_confirmed: false,
          image_url: null,
        },
        {
          visible: false,
          link_state: "ok",
          link_checked_at: "2026-09-01T00:00:00Z",
          made_in_taiwan_confirmed: true,
          image_url: "https://cdn/y.jpg",
        },
      ]),
    ).toEqual({
      visible: 2,
      linkChecked: 1,
      mitConfirmed: 1,
      withImage: 1,
    });
  });
});

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

function rowWith(overrides: Partial<CensusRow>): CensusRow {
  return { ...emptyCensusRow("alpha"), ...overrides };
}

describe("diffRow", () => {
  it("calls a count that went up an improvement and one that went down a regression", () => {
    const diffs = diffRow(
      rowWith({ active_image_count: 0, stockists_count: 3 }),
      rowWith({ active_image_count: 6, stockists_count: 1 }),
    );

    const byField = new Map(diffs.map((d) => [d.field, d]));
    expect(byField.get("active_image_count")?.direction).toBe("improved");
    expect(byField.get("stockists_count")?.direction).toBe("regressed");
  });

  it("inverts the direction for AI artifact hits — fewer is better", () => {
    const diffs = diffRow(
      rowWith({ description: { length: 200, aiArtifactHits: 3 } }),
      rowWith({ description: { length: 200, aiArtifactHits: 0 } }),
    );

    const byField = new Map(diffs.map((d) => [d.field, d]));
    expect(byField.get("description.ai_artifact_hits")?.direction).toBe("improved");
    expect(byField.get("description.length")?.direction).toBe("unchanged");
  });

  it("treats filling an empty link as an improvement and clearing it as a regression", () => {
    const filled = diffRow(
      rowWith({ purchase_website: null }),
      rowWith({ purchase_website: "https://alpha.com" }),
    ).find((d) => d.field === "purchase_website");
    expect(filled?.direction).toBe("improved");

    const cleared = diffRow(
      rowWith({ purchase_website: "https://alpha.com" }),
      rowWith({ purchase_website: null }),
    ).find((d) => d.field === "purchase_website");
    expect(cleared?.direction).toBe("regressed");
  });

  it("calls a swapped link changed, not improved — a different value is not a better one", () => {
    const swapped = diffRow(
      rowWith({ purchase_website: "https://old.example" }),
      rowWith({ purchase_website: "https://new.example" }),
    ).find((d) => d.field === "purchase_website");

    expect(swapped?.direction).toBe("changed");
    expect(swapped?.before).toBe("https://old.example");
    expect(swapped?.after).toBe("https://new.example");
  });

  it("marks every field unchanged for an identical row", () => {
    const row = rowWith({ active_image_count: 4 });
    expect(diffRow(row, row).every((d) => d.direction === "unchanged")).toBe(true);
  });
});

describe("renderCensusDiff", () => {
  const before: CensusFile = {
    cohort: "dev-1644-routing-pilot",
    capturedAt: "2026-09-03T00:00:00Z",
    rows: [rowWith({ slug: "alpha", active_image_count: 0 })],
  };
  const after: CensusFile = {
    cohort: "dev-1644-routing-pilot",
    capturedAt: "2026-09-03T02:00:00Z",
    rows: [rowWith({ slug: "alpha", active_image_count: 5 })],
  };

  it("prints one section per brand with before, after and the change marker", () => {
    const md = renderCensusDiff(before, after);

    expect(md).toContain("## alpha");
    expect(md).toContain("| active_image_count | 0 | 5 | improved |");
  });

  it("prints a totals line counting improved, regressed, changed and unchanged fields", () => {
    const md = renderCensusDiff(before, after);

    expect(md).toMatch(/improved 1/);
    expect(md).toMatch(/regressed 0/);
  });

  it("names a brand that only one side of the diff holds instead of dropping it", () => {
    const md = renderCensusDiff(before, {
      ...after,
      rows: [...after.rows, rowWith({ slug: "beta" })],
    });

    expect(md).toContain("beta");
    expect(md).toContain("missing");
  });
});

// ---------------------------------------------------------------------------
// Pending submission fields (DEV-1692)
// ---------------------------------------------------------------------------

describe("census pending submission fields", () => {
  it("census_counts_pending_submission_products_and_images — carries pending_* fields from a pending refresh submission", () => {
    const row = emptyCensusRow("alpha");
    // New fields should exist and default to zero
    expect(row.pending_products).toBe(0);
    expect(row.pending_candidate_rank_count).toBe(0);
    expect(row.pending_active_images).toBe(0);
    expect(row.pending_candidate_images).toBe(0);
  });

  it("census_counts_pending_submission_products_and_images — a row with pending data carries the counts", () => {
    const row: CensusRow = {
      ...emptyCensusRow("beta"),
      pending_products: 5,
      pending_candidate_rank_count: 3,
      pending_active_images: 8,
      pending_candidate_images: 2,
    };
    expect(row.pending_products).toBe(5);
    expect(row.pending_candidate_rank_count).toBe(3);
    expect(row.pending_active_images).toBe(8);
    expect(row.pending_candidate_images).toBe(2);
  });

  it("census_accepts_submission_ids_without_brand_rows — SubmissionCensusRow has slug: null", () => {
    const row: SubmissionCensusRow = {
      submission_id: "sub-001",
      slug: null,
      submission_denial_reason: null,
      pending_products: 4,
      pending_candidate_rank_count: 2,
      pending_active_images: 6,
      pending_candidate_images: 1,
    };
    expect(row.slug).toBeNull();
    expect(row.submission_id).toBe("sub-001");
    expect(row.pending_products).toBe(4);
  });

  it("diff_table_includes_pending_fields — the diff includes the pending_* fields", () => {
    const before = rowWith({
      pending_products: 0,
      pending_candidate_rank_count: 0,
      pending_active_images: 0,
      pending_candidate_images: 0,
    });
    const after = rowWith({
      pending_products: 5,
      pending_candidate_rank_count: 3,
      pending_active_images: 8,
      pending_candidate_images: 2,
    });
    const diffs = diffRow(before, after);
    const byField = new Map(diffs.map((d) => [d.field, d]));

    expect(byField.has("pending_products")).toBe(true);
    expect(byField.get("pending_products")?.direction).toBe("improved");
    expect(byField.get("pending_products")?.after).toBe("5");

    expect(byField.has("pending_candidate_rank_count")).toBe(true);
    expect(byField.get("pending_candidate_rank_count")?.direction).toBe("improved");

    expect(byField.has("pending_active_images")).toBe(true);
    expect(byField.get("pending_active_images")?.direction).toBe("improved");

    expect(byField.has("pending_candidate_images")).toBe(true);
    expect(byField.get("pending_candidate_images")?.direction).toBe("improved");
  });
});

// ---------------------------------------------------------------------------
// Channel-verdict outcome columns (DEV-1702)
// ---------------------------------------------------------------------------

describe("census channel-verdict outcome columns", () => {
  it("census_reports_hidden_reason_and_denial_reason_columns", () => {
    // The empty row carries the new columns, so a brand that was never touched
    // by a verdict still lines up column-for-column with one that was.
    const empty = emptyCensusRow("alpha");
    expect(empty.status).toBe("approved");
    expect(empty.hidden_reason).toBeNull();
    expect(empty.submission_denial_reason).toBeNull();
    expect(empty.link_sources).toBe("");

    const before: CensusFile = {
      cohort: "dev-1644-routing-pilot",
      capturedAt: "2026-09-05T00:00:00Z",
      rows: [
        rowWith({ slug: "91art-studio", status: "approved" }),
        rowWith({ slug: "one-wood" }),
      ],
    };
    const after: CensusFile = {
      cohort: "dev-1644-routing-pilot",
      capturedAt: "2026-09-05T02:00:00Z",
      rows: [
        rowWith({
          slug: "91art-studio",
          status: "hidden",
          hidden_reason: "no_purchase_channel",
          link_sources: "threads,serp",
        }),
        rowWith({
          slug: "one-wood",
          submission_denial_reason: "no_purchase_channel",
        }),
      ],
    };

    const hidden = new Map(
      diffRow(before.rows[0]!, after.rows[0]!).map((d) => [d.field, d]),
    );
    expect(hidden.get("status")?.before).toBe("approved");
    expect(hidden.get("status")?.after).toBe("hidden");
    // A brand leaving the directory is never an improvement, whatever the
    // reason: the diff must call it out, not bury it as "changed".
    expect(hidden.get("status")?.direction).toBe("regressed");
    expect(hidden.get("hidden_reason")?.after).toBe("no_purchase_channel");
    expect(hidden.get("link_sources")?.after).toBe("threads,serp");

    const denied = new Map(
      diffRow(before.rows[1]!, after.rows[1]!).map((d) => [d.field, d]),
    );
    expect(denied.get("submission_denial_reason")?.after).toBe(
      "no_purchase_channel",
    );

    const md = renderCensusDiff(before, after);
    expect(md).toContain("| status | approved | hidden | regressed |");
    expect(md).toContain("| hidden_reason | - | no_purchase_channel |");
    expect(md).toContain("| submission_denial_reason | - | no_purchase_channel |");
    expect(md).toContain("| link_sources | - | threads,serp |");
  });

  it("links_sources_lists_each_adopted_source_once_in_a_stable_order", () => {
    expect(
      linkSourcesFromPhaseResults([
        {
          phase: "gather",
          status: "succeeded",
          changedFields: [],
          durationMs: 1,
        },
        {
          phase: "acquire",
          status: "succeeded",
          changedFields: [],
          durationMs: 2,
          linkExpansion: {
            hubsFetched: 1,
            serp: "searched",
            adopted: [
              { field: "purchase_website", url: "https://a.example", source: "threads" },
              { field: "purchase_shopee", url: "https://b.example", source: "threads" },
              { field: "purchase_pinkoi", url: "https://c.example", source: "hub" },
            ],
          },
        },
      ]),
    ).toBe("threads,hub");
  });

  it("links_sources_is_empty_when_no_acquire_entry_expanded_a_link", () => {
    expect(linkSourcesFromPhaseResults([])).toBe("");
    expect(
      linkSourcesFromPhaseResults([
        {
          phase: "acquire",
          status: "succeeded",
          changedFields: [],
          durationMs: 2,
          linkExpansion: { hubsFetched: 0, serp: "none", adopted: [] },
        },
      ]),
    ).toBe("");
  });
});
