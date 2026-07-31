import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestClient, describeWithDb } from "@/test/setup";
import type { Database } from "@/lib/supabase/database.types";
import {
  buildFeatureRequestBoard,
  countVotesByRequest,
  FEATURE_REQUEST_TITLE_MAX,
  listAllFeatureRequests,
  listFeatureRequests,
  mergeFeatureRequests,
  rowToFeatureRequest,
  setFeatureRequestVote,
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

// Built lazily: `describe.skip` still executes this callback during
// collection, so the client must not be constructed when the integration env
// is absent (createTestClient throws on a missing/unsafe database URL).
const testClient =
  process.env.RUN_SUPABASE_INTEGRATION_TESTS === "true"
    ? createTestClient()
    : null;

describeWithDb("feature requests service (database)", () => {
  const supabase = testClient!;
  const requestIds: string[] = [];
  const userIds: string[] = [];

  async function createUser(): Promise<string> {
    const { data, error } = await supabase.auth.admin.createUser({
      email: `feature-request-${randomUUID()}@example.com`,
      password: `Feature-request-${randomUUID()}`,
      email_confirm: true,
    });
    if (error || !data.user) throw error ?? new Error("user creation failed");
    userIds.push(data.user.id);
    return data.user.id;
  }

  async function createRequest(
    overrides: Record<string, unknown> = {},
  ): Promise<string> {
    const { data, error } = await supabase
      .from("feature_requests")
      .insert({
        title: `Test request ${randomUUID().slice(0, 8)}`,
        ...overrides,
      })
      .select("id")
      .single();
    if (error || !data) throw error ?? new Error("request creation failed");
    requestIds.push(data.id as string);
    return data.id as string;
  }

  async function voteCount(requestId: string): Promise<number> {
    const { count, error } = await supabase
      .from("feature_request_votes")
      .select("id", { count: "exact", head: true })
      .eq("request_id", requestId);
    if (error) throw error;
    return count ?? 0;
  }

  let voter = "";

  beforeAll(async () => {
    voter = await createUser();
  });

  afterAll(async () => {
    if (requestIds.length > 0) {
      await supabase.from("feature_requests").delete().in("id", requestIds);
      requestIds.length = 0;
    }
    for (const userId of userIds) {
      await supabase.auth.admin.deleteUser(userId);
    }
    userIds.length = 0;
  });

  it("setFeatureRequestVote is idempotent", async () => {
    const requestId = await createRequest();

    const first = await setFeatureRequestVote(
      requestId,
      { userId: voter },
      true,
    );
    const second = await setFeatureRequestVote(
      requestId,
      { userId: voter },
      true,
    );

    expect(first).toEqual({ ok: true, count: 1, voted: true });
    expect(second).toEqual({ ok: true, count: 1, voted: true });
    expect(await voteCount(requestId)).toBe(1);
  });

  it("setFeatureRequestVote removes the vote when voted is false", async () => {
    const requestId = await createRequest();

    await setFeatureRequestVote(requestId, { userId: voter }, true);
    const removed = await setFeatureRequestVote(
      requestId,
      { userId: voter },
      false,
    );

    expect(removed).toEqual({ ok: true, count: 0, voted: false });
    expect(await voteCount(requestId)).toBe(0);
  });

  // The guest path is the reason the unique constraint became two partial
  // indexes, which is also why the write is now an insert with 23505 swallowed
  // instead of an upsert — PostgREST cannot infer a partial index from an
  // `onConflict` list, so only a real database proves this stayed idempotent.
  it("setFeatureRequestVote dedups a guest vote by visitor hash", async () => {
    const requestId = await createRequest();
    const visitorHash = randomUUID().replace(/-/g, "").repeat(2);

    const first = await setFeatureRequestVote(requestId, { visitorHash }, true);
    const second = await setFeatureRequestVote(requestId, { visitorHash }, true);

    expect(first).toEqual({ ok: true, count: 1, voted: true });
    expect(second).toEqual({ ok: true, count: 1, voted: true });
    expect(await voteCount(requestId)).toBe(1);

    const removed = await setFeatureRequestVote(
      requestId,
      { visitorHash },
      false,
    );
    expect(removed).toEqual({ ok: true, count: 0, voted: false });
    expect(await voteCount(requestId)).toBe(0);
  });

  // An account and a guest voting on the same request are two distinct voters,
  // and neither partial index may collapse them into one.
  it("setFeatureRequestVote counts an account and a guest separately", async () => {
    const requestId = await createRequest();
    const visitorHash = randomUUID().replace(/-/g, "").repeat(2);

    await setFeatureRequestVote(requestId, { userId: voter }, true);
    const guest = await setFeatureRequestVote(requestId, { visitorHash }, true);

    expect(guest).toEqual({ ok: true, count: 2, voted: true });
  });

  it("setFeatureRequestVote rejects a merged request", async () => {
    const target = await createRequest();
    const merged = await createRequest({
      merged_into_id: target,
      status: "duplicate",
    });

    await expect(
      setFeatureRequestVote(merged, { userId: voter }, true),
    ).resolves.toEqual({
      ok: false,
      code: "merged",
    });
  });

  it("submitFeatureRequest persists a request without exposing the submitter", async () => {
    const result = await submitFeatureRequest({
      title: "Export my saved brands",
      body: "A CSV would do.",
      userId: voter,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    requestIds.push(result.id);

    const { data } = await supabase
      .from("feature_requests")
      .select("submitted_by")
      .eq("id", result.id)
      .single();
    expect(data?.submitted_by).toBe(voter);
  });

  // The SQL-side clauses live in the query builder, not in the pure assembler
  // above, so they can only be pinned against a real database — mocking
  // `@/lib/supabase/*` is forbidden by scripts/check-test-boundaries.mjs.
  it("listFeatureRequests applies the merged and limit clauses", async () => {
    const target = await createRequest();
    const merged = await createRequest({
      merged_into_id: target,
      status: "duplicate",
    });

    const board = await listFeatureRequests();
    const boardIds = board.map((entry) => entry.id);
    expect(boardIds).toContain(target);
    expect(boardIds).not.toContain(merged);

    const limited = await listFeatureRequests({ limit: 1 });
    expect(limited).toHaveLength(1);
  });

  it("listAllFeatureRequests keeps merged tombstones", async () => {
    const target = await createRequest();
    const merged = await createRequest({
      merged_into_id: target,
      status: "duplicate",
    });

    const ids = (await listAllFeatureRequests()).map((entry) => entry.id);
    expect(ids).toContain(target);
    expect(ids).toContain(merged);
  });

  it("mergeFeatureRequests re-points votes", async () => {
    const source = await createRequest();
    const target = await createRequest();
    const sourceVoter = await createUser();
    const targetVoter = await createUser();

    await setFeatureRequestVote(source, { userId: sourceVoter }, true);
    await setFeatureRequestVote(target, { userId: targetVoter }, true);

    const result = await mergeFeatureRequests(source, target);

    expect(result).toEqual({ ok: true, movedVotes: 1 });
    expect(await voteCount(target)).toBe(2);
    expect(await voteCount(source)).toBe(0);

    const { data } = await supabase
      .from("feature_requests")
      .select("merged_into_id, status")
      .eq("id", source)
      .single();
    expect(data?.merged_into_id).toBe(target);
    expect(data?.status).toBe("duplicate");
  });

  // Guest votes are matched on a different column than account votes, so the
  // re-point step runs as two statements. Without the second one a merge would
  // silently delete every guest vote on the source.
  it("mergeFeatureRequests re-points guest votes", async () => {
    const source = await createRequest();
    const target = await createRequest();
    const movingGuest = randomUUID().replace(/-/g, "").repeat(2);
    const overlappingGuest = randomUUID().replace(/-/g, "").repeat(2);

    await setFeatureRequestVote(source, { visitorHash: movingGuest }, true);
    await setFeatureRequestVote(source, { visitorHash: overlappingGuest }, true);
    await setFeatureRequestVote(target, { visitorHash: overlappingGuest }, true);

    const result = await mergeFeatureRequests(source, target);

    expect(result).toEqual({ ok: true, movedVotes: 1 });
    expect(await voteCount(target)).toBe(2);
    expect(await voteCount(source)).toBe(0);
  });

  it("mergeFeatureRequests survives an overlapping voter", async () => {
    const source = await createRequest();
    const target = await createRequest();
    const overlapping = await createUser();
    const sourceOnly = await createUser();

    await setFeatureRequestVote(source, { userId: overlapping }, true);
    await setFeatureRequestVote(target, { userId: overlapping }, true);
    await setFeatureRequestVote(source, { userId: sourceOnly }, true);

    const result = await mergeFeatureRequests(source, target);

    expect(result).toEqual({ ok: true, movedVotes: 1 });
    expect(await voteCount(target)).toBe(2);
    expect(await voteCount(source)).toBe(0);

    const { data } = await supabase
      .from("feature_request_votes")
      .select("user_id")
      .eq("request_id", target)
      .eq("user_id", overlapping);
    expect(data).toHaveLength(1);
  });
});
