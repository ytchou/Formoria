import { beforeEach, describe, expect, it, vi } from "vitest";

import { createInMemoryRateLimiter } from "@/lib/security/rate-limiter";
import type {
  SetFeatureRequestVoteResult,
  SubmitFeatureRequestResult,
} from "@/lib/services/feature-requests";
import {
  FEATURE_REQUEST_ACTION_ERRORS,
  runGetMyVotedRequestIds,
  runSetFeatureRequestVote,
  runSubmitFeatureRequest,
  type FeatureRequestActionDeps,
} from "./feature-requests-core";

const REQUEST_ID = "3f1c1b7a-0f6f-4a4a-9a1a-9b1a4a4a1b7a";
const SIGNED_IN_USER = "c0ffee00-1111-4222-8333-444444444444";
const CLIENT_IP = "203.0.113.7";
const GUEST_EMAIL = "guest@example.com";
// Shaped like a real one: the column's CHECK is `^[0-9a-f]{64}$`.
const VISITOR_HASH = "a".repeat(64);

/**
 * Fakes are injected, never `vi.mock`ed: `scripts/check-test-boundaries.mjs`
 * forbids mocking `@/lib/services/*` and `@/lib/supabase/*`. The rate limiter
 * is the REAL sliding-window store, so the cap assertions exercise production
 * logic rather than a stub.
 */
function makeDeps(
  overrides: Partial<FeatureRequestActionDeps> = {},
): FeatureRequestActionDeps {
  const store = createInMemoryRateLimiter();

  return {
    getUserId: vi.fn(async () => SIGNED_IN_USER as string | null),
    getClientIp: vi.fn(async () => CLIENT_IP),
    ensureVisitorHash: vi.fn(async () => VISITOR_HASH),
    readVisitorHash: vi.fn(async () => VISITOR_HASH as string | null),
    checkRateLimit: vi.fn(async (identifier, options) =>
      store.check(
        options.prefix ? `${options.prefix}:${identifier}` : identifier,
        options.windowMs,
        options.maxRequests,
      ),
    ),
    submitFeatureRequest: vi.fn(
      async (): Promise<SubmitFeatureRequestResult> => ({
        ok: true,
        id: REQUEST_ID,
      }),
    ),
    setFeatureRequestVote: vi.fn(
      async (): Promise<SetFeatureRequestVoteResult> => ({
        ok: true,
        count: 1,
        voted: true,
      }),
    ),
    getMyVotedRequestIds: vi.fn(async () => [REQUEST_ID]),
    ...overrides,
  };
}

function validSubmitInput() {
  return {
    title: "Add a comparison view",
    body: "Side by side brands.",
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("submitFeatureRequestAction", () => {
  // The board is in cold start: a sign-in wall on the one flow that creates
  // rows is friction it cannot afford, so a guest submit is a success path.
  it("submitFeatureRequestAction accepts a signed-out caller", async () => {
    const deps = makeDeps({ getUserId: vi.fn(async () => null) });

    await expect(
      runSubmitFeatureRequest(deps, {
        ...validSubmitInput(),
        guestEmail: GUEST_EMAIL,
      }),
    ).resolves.toEqual({ ok: true, id: REQUEST_ID });
    expect(deps.submitFeatureRequest).toHaveBeenCalledWith(
      expect.objectContaining({ userId: null, guestEmail: GUEST_EMAIL }),
    );
  });

  // Tier one keys on the account when there is one and on the host when there
  // is not, so a guest cannot spend a signed-in submitter's budget and vice
  // versa. Both share the same 3/hour cap.
  it("submitFeatureRequestAction keys the submit cap by identity", async () => {
    const guestDeps = makeDeps({ getUserId: vi.fn(async () => null) });
    await runSubmitFeatureRequest(guestDeps, validSubmitInput());
    expect(guestDeps.checkRateLimit).toHaveBeenCalledWith(
      `ip:${CLIENT_IP}`,
      expect.objectContaining({ prefix: "feature-request-submit" }),
    );

    const userDeps = makeDeps();
    await runSubmitFeatureRequest(userDeps, validSubmitInput());
    expect(userDeps.checkRateLimit).toHaveBeenCalledWith(
      `user:${SIGNED_IN_USER}`,
      expect.objectContaining({ prefix: "feature-request-submit" }),
    );
  });

  it("submitFeatureRequestAction rate-limits a guest on the same budget", async () => {
    const deps = makeDeps({ getUserId: vi.fn(async () => null) });

    const results = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      results.push(await runSubmitFeatureRequest(deps, validSubmitInput()));
    }

    expect(results[3]).toEqual({ ok: false, error: "rate_limited" });
    expect(deps.submitFeatureRequest).toHaveBeenCalledTimes(3);
  });

  it("submitFeatureRequestAction rejects a malformed guest email", async () => {
    const deps = makeDeps({ getUserId: vi.fn(async () => null) });

    await expect(
      runSubmitFeatureRequest(deps, {
        ...validSubmitInput(),
        guestEmail: "not-an-email",
      }),
    ).resolves.toEqual({ ok: false, error: "invalid_input" });
    expect(deps.submitFeatureRequest).not.toHaveBeenCalled();
  });

  // An untouched optional field arrives as "" from a controlled input, which
  // must not fail the submission.
  it("submitFeatureRequestAction accepts an empty guest email", async () => {
    const deps = makeDeps({ getUserId: vi.fn(async () => null) });

    await expect(
      runSubmitFeatureRequest(deps, { ...validSubmitInput(), guestEmail: "" }),
    ).resolves.toEqual({ ok: true, id: REQUEST_ID });
  });

  // A signed-in submitter keeps their account identity even if a stale client
  // sends a guestEmail. Dropping the address itself is the service layer's
  // guard — this only pins that the action does not swap the identity for it.
  it("submitFeatureRequestAction keeps the account identity over a guest email", async () => {
    const deps = makeDeps();

    await runSubmitFeatureRequest(deps, {
      ...validSubmitInput(),
      guestEmail: GUEST_EMAIL,
    });

    expect(deps.submitFeatureRequest).toHaveBeenCalledWith(
      expect.objectContaining({ userId: SIGNED_IN_USER }),
    );
    expect(deps.checkRateLimit).toHaveBeenCalledWith(
      `user:${SIGNED_IN_USER}`,
      expect.objectContaining({ prefix: "feature-request-submit" }),
    );
  });

  it("submitFeatureRequestAction rejects an invalid payload", async () => {
    const deps = makeDeps();

    const shortTitle = await runSubmitFeatureRequest(deps, {
      ...validSubmitInput(),
      title: "abc",
    });

    expect(shortTitle).toEqual({ ok: false, error: "invalid_input" });
    expect(deps.submitFeatureRequest).not.toHaveBeenCalled();
  });

  // The body is the substance of a request, so an empty or one-word one is
  // rejected before it can reach the board or spend rate-limit budget.
  it("submitFeatureRequestAction rejects a body under the minimum", async () => {
    const deps = makeDeps();

    for (const body of ["", "too short"]) {
      const result = await runSubmitFeatureRequest(deps, {
        ...validSubmitInput(),
        body,
      });
      expect(result).toEqual({ ok: false, error: "invalid_input" });
    }
    expect(deps.submitFeatureRequest).not.toHaveBeenCalled();
  });

  it("submitFeatureRequestAction returns rate_limited past the cap", async () => {
    const deps = makeDeps();

    const results = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      results.push(await runSubmitFeatureRequest(deps, validSubmitInput()));
    }

    expect(results.slice(0, 3)).toEqual([
      { ok: true, id: REQUEST_ID },
      { ok: true, id: REQUEST_ID },
      { ok: true, id: REQUEST_ID },
    ]);
    expect(results[3]).toEqual({ ok: false, error: "rate_limited" });
    expect(deps.submitFeatureRequest).toHaveBeenCalledTimes(3);
  });
});

describe("setFeatureRequestVoteAction", () => {
  // The sign-in wall on voting is gone: a guest votes as the anonymous browser
  // identity behind the signed visitor cookie, minted here because a vote is a
  // write.
  it("setFeatureRequestVoteAction accepts a signed-out caller", async () => {
    const deps = makeDeps({ getUserId: vi.fn(async () => null) });

    await expect(
      runSetFeatureRequestVote(deps, { requestId: REQUEST_ID, voted: true }),
    ).resolves.toEqual({ ok: true, count: 1, voted: true });
    expect(deps.ensureVisitorHash).toHaveBeenCalled();
    expect(deps.setFeatureRequestVote).toHaveBeenCalledWith(
      REQUEST_ID,
      { visitorHash: VISITOR_HASH },
      true,
    );
  });

  // Tier one keys on the account when there is one and on the visitor hash when
  // there is not, so a guest cannot spend a signed-in voter's budget.
  it("setFeatureRequestVoteAction keys the vote cap by identity", async () => {
    const guestDeps = makeDeps({ getUserId: vi.fn(async () => null) });
    await runSetFeatureRequestVote(guestDeps, {
      requestId: REQUEST_ID,
      voted: true,
    });
    expect(guestDeps.checkRateLimit).toHaveBeenCalledWith(
      `visitor:${VISITOR_HASH}`,
      expect.objectContaining({ prefix: "feature-request-vote" }),
    );

    const userDeps = makeDeps();
    await runSetFeatureRequestVote(userDeps, {
      requestId: REQUEST_ID,
      voted: true,
    });
    expect(userDeps.checkRateLimit).toHaveBeenCalledWith(
      `user:${SIGNED_IN_USER}`,
      expect.objectContaining({ prefix: "feature-request-vote" }),
    );
  });

  // Tier three is the anti-brigading cap, and it is asymmetric on purpose: an
  // added vote spends budget, an unvote must not — otherwise a mis-click costs
  // the visitor their whole day on that request.
  it("setFeatureRequestVoteAction caps added votes per request and host", async () => {
    const deps = makeDeps();

    const results = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      results.push(
        await runSetFeatureRequestVote(deps, {
          requestId: REQUEST_ID,
          voted: true,
        }),
      );
    }

    expect(results[4]).toEqual({ ok: true, count: 1, voted: true });
    expect(results[5]).toEqual({ ok: false, error: "rate_limited" });
    expect(deps.setFeatureRequestVote).toHaveBeenCalledTimes(5);
  });

  it("setFeatureRequestVoteAction does not charge the per-request cap for an unvote", async () => {
    const deps = makeDeps({
      setFeatureRequestVote: vi.fn(async () => ({
        ok: true as const,
        count: 0,
        voted: false,
      })),
    });

    const results = [];
    for (let attempt = 0; attempt < 8; attempt += 1) {
      results.push(
        await runSetFeatureRequestVote(deps, {
          requestId: REQUEST_ID,
          voted: false,
        }),
      );
    }

    expect(results.every((result) => result.ok)).toBe(true);
    expect(deps.checkRateLimit).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        prefix: "feature-request-vote-request-ip",
      }),
    );
  });

  it("returns the fresh count on success", async () => {
    const deps = makeDeps();

    await expect(
      runSetFeatureRequestVote(deps, { requestId: REQUEST_ID, voted: true }),
    ).resolves.toEqual({ ok: true, count: 1, voted: true });
    expect(deps.setFeatureRequestVote).toHaveBeenCalledWith(
      REQUEST_ID,
      { userId: SIGNED_IN_USER },
      true,
    );
  });
});

describe("getMyVotedRequestIdsAction", () => {
  // A visitor who has never voted has no cookie, and a read must not mint one:
  // an empty result is the answer, not an error and not a new identifier.
  it("getMyVotedRequestIdsAction returns an empty list for a cookie-less visitor", async () => {
    const deps = makeDeps({
      getUserId: vi.fn(async () => null),
      readVisitorHash: vi.fn(async () => null),
    });

    await expect(runGetMyVotedRequestIds(deps)).resolves.toEqual({
      ok: true,
      requestIds: [],
    });
    expect(deps.getMyVotedRequestIds).not.toHaveBeenCalled();
    expect(deps.ensureVisitorHash).not.toHaveBeenCalled();
  });

  it("getMyVotedRequestIdsAction reads a guest's votes by visitor hash", async () => {
    const deps = makeDeps({ getUserId: vi.fn(async () => null) });

    await expect(runGetMyVotedRequestIds(deps)).resolves.toEqual({
      ok: true,
      requestIds: [REQUEST_ID],
    });
    expect(deps.getMyVotedRequestIds).toHaveBeenCalledWith({
      visitorHash: VISITOR_HASH,
    });
    expect(deps.ensureVisitorHash).not.toHaveBeenCalled();
  });
});

describe("action error mapping", () => {
  it("action errors never leak service codes", async () => {
    // The throwing cases log through the standard `[feature-requests:*]`
    // console.error path; silence it so the suite output stays readable.
    vi.spyOn(console, "error").mockImplementation(() => {});
    const failures: { ok: false; error: string }[] = [];

    const collect = (
      result:
        | { ok: true }
        | { ok: false; error: string }
        | { ok: true; id: string }
        | { ok: true; count: number; voted: boolean }
        | { ok: true; requestIds: string[] },
    ) => {
      if (!result.ok) failures.push(result);
    };

    for (const code of [
      "database_error",
      "already_submitted",
      "invalid_input",
    ] as const) {
      collect(
        await runSubmitFeatureRequest(
          makeDeps({
            submitFeatureRequest: vi.fn(
              async (): Promise<SubmitFeatureRequestResult> => ({
                ok: false,
                code,
              }),
            ),
          }),
          validSubmitInput(),
        ),
      );
    }

    collect(
      await runSubmitFeatureRequest(
        makeDeps({
          submitFeatureRequest: vi.fn(async () => {
            throw new Error("boom");
          }),
        }),
        validSubmitInput(),
      ),
    );

    for (const code of ["not_found", "merged", "database_error"] as const) {
      collect(
        await runSetFeatureRequestVote(
          makeDeps({
            setFeatureRequestVote: vi.fn(
              async (): Promise<SetFeatureRequestVoteResult> => ({
                ok: false,
                code,
              }),
            ),
          }),
          { requestId: REQUEST_ID, voted: true },
        ),
      );
    }

    collect(
      await runGetMyVotedRequestIds(
        makeDeps({
          getMyVotedRequestIds: vi.fn(async () => {
            throw new Error("boom");
          }),
        }),
      ),
    );

    expect(failures).toHaveLength(8);
    for (const failure of failures) {
      expect(FEATURE_REQUEST_ACTION_ERRORS).toContain(failure.error);
    }
    expect(failures.map((failure) => failure.error)).not.toContain(
      "database_error",
    );
  });
});
