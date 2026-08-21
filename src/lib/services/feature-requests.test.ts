import { describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import {
  buildFeatureRequestBoard,
  countVotesByRequest,
  FEATURE_REQUEST_TITLE_MAX,
  mergeFeatureRequests,
  rowToFeatureRequest,
  submitErrorCode,
  submitFeatureRequest,
} from "./feature-requests";

type FeatureRequestRow =
  Database["public"]["Tables"]["feature_requests"]["Row"];

function row(overrides: Partial<FeatureRequestRow> = {}): FeatureRequestRow {
  return {
    id: "request-1",
    title: "Add a dark mode",
    body: "The board is blinding at night.",
    status: "open",
    submitted_by: "11111111-1111-1111-1111-111111111111",
    guest_email: null,
    merged_into_id: null,
    is_seed: false,
    admin_note: null,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("rowToFeatureRequest", () => {
  it("derives stable i18n keys for every localized seed request", () => {
    const seeds = [
      ["Add reviews and ratings to brand pages", "brand_reviews"],
      ["Browse Taiwanese brands by occasion", "occasion_discovery"],
      ["Show nearby Taiwanese brands on a map", "nearby_brand_map"],
      [
        "Let brand owners claim and manage their brand page",
        "owner_claim_flow",
      ],
    ] as const;

    for (const [title, i18nKey] of seeds) {
      expect(
        rowToFeatureRequest(row({ is_seed: true, title }), 0).i18nKey,
      ).toBe(i18nKey);
    }
  });

  it("rowToFeatureRequest omits submitted_by", () => {
    const inputs: FeatureRequestRow[] = [
      row(),
      row({ id: "request-2", submitted_by: null }),
      row({
        id: "request-3",
        submitted_by: "22222222-2222-2222-2222-222222222222",
        status: "shipped",
        merged_into_id: "request-1",
        is_seed: true,
        admin_note: "shipped in 1.4",
      }),
    ];

    for (const input of inputs) {
      const projected = rowToFeatureRequest(input, 3);
      const keys = Object.keys(projected);

      expect(keys).not.toContain("submittedBy");
      expect(keys).not.toContain("submitted_by");
      if (input.submitted_by) {
        expect(JSON.stringify(projected)).not.toContain(input.submitted_by);
      }
      expect(projected.voteCount).toBe(3);
    }
  });

  // A guest's reply-to address is internal: the board is a public RSC payload,
  // so the projection is the boundary that keeps the address out of it.
  it("rowToFeatureRequest omits guest_email", () => {
    const guestEmail = "guest@example.com";
    const inputs: FeatureRequestRow[] = [
      row({ submitted_by: null, guest_email: guestEmail }),
      row({ id: "request-2", guest_email: guestEmail }),
    ];

    for (const input of inputs) {
      const projected = rowToFeatureRequest(input, 1);
      const keys = Object.keys(projected);

      expect(keys).not.toContain("guestEmail");
      expect(keys).not.toContain("guest_email");
      expect(JSON.stringify(projected)).not.toContain(guestEmail);
    }
  });

  // A guest voter's `visitor_hash` is a stable per-browser identifier. It never
  // belongs in a public RSC payload, so the projection is pinned to hold no
  // trace of it however the vote data around it is reshaped.
  it("rowToFeatureRequest omits visitor_hash", () => {
    const visitorHash = "b".repeat(64);
    // Widened deliberately: the column lives on the votes table, so this pins
    // that the projection stays a fixed field list even if a caller ever hands
    // it a joined row.
    const input = { ...row({ submitted_by: null }), visitor_hash: visitorHash };
    const projected = rowToFeatureRequest(input, 2);
    const keys = Object.keys(projected);

    expect(keys).not.toContain("visitorHash");
    expect(keys).not.toContain("visitor_hash");
    expect(JSON.stringify(projected)).not.toContain(visitorHash);
  });
});

describe("buildFeatureRequestBoard", () => {
  it("buildFeatureRequestBoard excludes merged requests", () => {
    const board = buildFeatureRequestBoard(
      [row({ id: "kept" }), row({ id: "merged", merged_into_id: "kept" })],
      [],
    );

    expect(board.map((entry) => entry.id)).toEqual(["kept"]);
  });

  // A decline is a decision already made, so the public board stops carrying
  // it. The admin queue reads through `listAllFeatureRequests`, which does not
  // go through this filter and still sees the row.
  it("buildFeatureRequestBoard excludes declined requests", () => {
    const board = buildFeatureRequestBoard(
      [
        row({ id: "kept", status: "open" }),
        row({ id: "declined", status: "declined" }),
      ],
      [],
    );

    expect(board.map((entry) => entry.id)).toEqual(["kept"]);
  });

  // A shipped request is already done, so the public board stops carrying it —
  // it needs no vote. The admin queue reads through `listAllFeatureRequests`,
  // which does not go through this filter and still sees the row.
  it("buildFeatureRequestBoard excludes shipped requests", () => {
    const board = buildFeatureRequestBoard(
      [
        row({ id: "kept", status: "open" }),
        row({ id: "shipped", status: "shipped" }),
      ],
      [],
    );

    expect(board.map((entry) => entry.id)).toEqual(["kept"]);
  });

  it("buildFeatureRequestBoard sorts by votes desc then created desc", () => {
    const board = buildFeatureRequestBoard(
      [
        row({ id: "older-tie", created_at: "2026-07-01T00:00:00.000Z" }),
        row({ id: "low", created_at: "2026-07-05T00:00:00.000Z" }),
        row({ id: "newer-tie", created_at: "2026-07-03T00:00:00.000Z" }),
        row({ id: "top", created_at: "2026-06-01T00:00:00.000Z" }),
      ],
      [
        { request_id: "top" },
        { request_id: "top" },
        { request_id: "top" },
        { request_id: "older-tie" },
        { request_id: "older-tie" },
        { request_id: "newer-tie" },
        { request_id: "newer-tie" },
        { request_id: "low" },
      ],
    );

    expect(board.map((entry) => entry.id)).toEqual([
      "top",
      "newer-tie",
      "older-tie",
      "low",
    ]);
    expect(board.map((entry) => entry.voteCount)).toEqual([3, 2, 2, 1]);
  });

  it("counts votes without a query per request", () => {
    const counts = countVotesByRequest([
      { request_id: "a" },
      { request_id: "b" },
      { request_id: "a" },
    ]);

    expect(counts.get("a")).toBe(2);
    expect(counts.get("b")).toBe(1);
  });
});

describe("submitFeatureRequest error mapping", () => {
  it("submitFeatureRequest maps 23505 to already_submitted", () => {
    expect(submitErrorCode({ code: "23505" })).toBe("already_submitted");
    expect(submitErrorCode({ code: "23503" })).toBe("database_error");
    expect(submitErrorCode(null)).toBe("database_error");
  });
});

// These run with no database on purpose: the guard returns before the service
// client is constructed, so the bounds are pinned without an integration env.
describe("submitFeatureRequest input guards", () => {
  const VALID_TITLE = "Export my saved brands";
  const VALID_BODY = "A CSV export would be enough.";

  it("submitFeatureRequest rejects a body under the minimum", async () => {
    for (const body of ["", "   ", "too short"]) {
      await expect(
        submitFeatureRequest({ title: VALID_TITLE, body, userId: "user-1" }),
      ).resolves.toEqual({ ok: false, code: "invalid_input" });
    }
  });

  it("submitFeatureRequest rejects a title past the maximum", async () => {
    await expect(
      submitFeatureRequest({
        title: "x".repeat(FEATURE_REQUEST_TITLE_MAX + 1),
        body: VALID_BODY,
        userId: "user-1",
      }),
    ).resolves.toEqual({ ok: false, code: "invalid_input" });
  });
});

describe("mergeFeatureRequests guards", () => {
  it("mergeFeatureRequests rejects merging into itself", async () => {
    const id = "11111111-1111-1111-1111-111111111111";
    await expect(mergeFeatureRequests(id, id)).resolves.toEqual({
      ok: false,
      code: "invalid_target",
    });
  });
});
