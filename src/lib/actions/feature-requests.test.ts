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
    getClientIp: vi.fn(async () => "203.0.113.7"),
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
    category: "visitor" as const,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("submitFeatureRequestAction", () => {
  it("submitFeatureRequestAction rejects an unauthenticated caller", async () => {
    const deps = makeDeps({ getUserId: vi.fn(async () => null) });

    await expect(
      runSubmitFeatureRequest(deps, validSubmitInput()),
    ).resolves.toEqual({ ok: false, error: "unauthenticated" });
    expect(deps.submitFeatureRequest).not.toHaveBeenCalled();
  });

  it("submitFeatureRequestAction rejects an invalid payload", async () => {
    const deps = makeDeps();

    const shortTitle = await runSubmitFeatureRequest(deps, {
      ...validSubmitInput(),
      title: "abc",
    });
    const unknownCategory = await runSubmitFeatureRequest(deps, {
      ...validSubmitInput(),
      category: "staff" as unknown as "owner",
    });

    expect(shortTitle).toEqual({ ok: false, error: "invalid_input" });
    expect(unknownCategory).toEqual({ ok: false, error: "invalid_input" });
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
  it("setFeatureRequestVoteAction rejects an unauthenticated caller", async () => {
    const deps = makeDeps({ getUserId: vi.fn(async () => null) });

    await expect(
      runSetFeatureRequestVote(deps, { requestId: REQUEST_ID, voted: true }),
    ).resolves.toEqual({ ok: false, error: "unauthenticated" });
    expect(deps.setFeatureRequestVote).not.toHaveBeenCalled();
  });

  it("returns the fresh count on success", async () => {
    const deps = makeDeps();

    await expect(
      runSetFeatureRequestVote(deps, { requestId: REQUEST_ID, voted: true }),
    ).resolves.toEqual({ ok: true, count: 1, voted: true });
    expect(deps.setFeatureRequestVote).toHaveBeenCalledWith(
      REQUEST_ID,
      SIGNED_IN_USER,
      true,
    );
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
