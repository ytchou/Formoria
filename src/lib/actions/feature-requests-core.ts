import { z } from "zod/v3";

import type {
  RateLimitOptions,
  RateLimitResult,
} from "@/lib/security/rate-limiter";
import {
  FEATURE_REQUEST_BODY_MAX,
  FEATURE_REQUEST_TITLE_MAX,
  FEATURE_REQUEST_TITLE_MIN,
  type getMyVotedRequestIds,
  type setFeatureRequestVote,
  type submitFeatureRequest,
  type SetFeatureRequestVoteResult,
  type SubmitFeatureRequestResult,
} from "@/lib/services/feature-requests";

/**
 * Implementation half of the feature-request server actions. It lives outside
 * the `"use server"` module because a Server Action's parameters are
 * client-controllable — an injectable `deps` argument on the exported action
 * would let a caller supply its own `getUserId`. Here the seam is unreachable
 * from the network, and the tests exercise it by passing fakes rather than by
 * mocking `@/lib/services/*`, which `scripts/check-test-boundaries.mjs` forbids.
 */
export type FeatureRequestActionDeps = {
  getUserId: () => Promise<string | null>;
  getClientIp: () => Promise<string>;
  checkRateLimit: (
    identifier: string,
    options: RateLimitOptions,
  ) => Promise<RateLimitResult>;
  submitFeatureRequest: typeof submitFeatureRequest;
  setFeatureRequestVote: typeof setFeatureRequestVote;
  getMyVotedRequestIds: typeof getMyVotedRequestIds;
};

// Bounds come from the service module so the schema, the service guard, the
// dialog, and the migration's CHECK constraints cannot drift apart.
const submitInputSchema = z.object({
  title: z
    .string()
    .trim()
    .min(FEATURE_REQUEST_TITLE_MIN)
    .max(FEATURE_REQUEST_TITLE_MAX),
  body: z.string().trim().max(FEATURE_REQUEST_BODY_MAX).optional(),
  category: z.enum(["owner", "visitor"]),
});

const voteInputSchema = z.object({
  requestId: z.string().uuid(),
  voted: z.boolean(),
});

// Keyed by user, not IP: the board is authenticated-write-only, so the account
// is the real identity and an IP key would throttle everyone behind one campus
// NAT together.
const SUBMIT_RATE_LIMIT = {
  windowMs: 3_600_000,
  maxRequests: 3,
  prefix: "feature-request-submit",
} as const;

const VOTE_RATE_LIMIT = {
  windowMs: 60_000,
  maxRequests: 30,
  prefix: "feature-request-vote",
} as const;

// Secondary, deliberately loose cap on the one flow that creates rows. The
// per-user cap is the real gate; this only raises the cost of farming throwaway
// accounts from one host. Ceiling: a determined abuser on rotating IPs still
// gets through — add account-age or email-verification gating if that happens.
const SUBMIT_IP_RATE_LIMIT = {
  windowMs: 3_600_000,
  maxRequests: 10,
  prefix: "feature-request-submit-ip",
} as const;

export type SubmitFeatureRequestActionInput = z.infer<typeof submitInputSchema>;
export type SetFeatureRequestVoteActionInput = z.infer<typeof voteInputSchema>;

/**
 * The action layer's error vocabulary. Service codes are mapped into this union
 * and never returned directly — the client renders these strings, so a leaked
 * `database_error` would both break the copy lookup and describe our internals.
 */
export type FeatureRequestActionError =
  | "unauthenticated"
  | "invalid_input"
  | "rate_limited"
  | "not_found"
  | "merged"
  | "already_submitted"
  | "unavailable";

export const FEATURE_REQUEST_ACTION_ERRORS: readonly FeatureRequestActionError[] =
  [
    "unauthenticated",
    "invalid_input",
    "rate_limited",
    "not_found",
    "merged",
    "already_submitted",
    "unavailable",
  ];

export type SubmitFeatureRequestActionResult =
  { ok: true; id: string } | { ok: false; error: FeatureRequestActionError };

export type SetFeatureRequestVoteActionResult =
  | { ok: true; count: number; voted: boolean }
  | { ok: false; error: FeatureRequestActionError };

export type GetMyVotedRequestIdsActionResult =
  | { ok: true; requestIds: string[] }
  | { ok: false; error: FeatureRequestActionError };

function mapSubmitError(
  code: Extract<SubmitFeatureRequestResult, { ok: false }>["code"],
): FeatureRequestActionError {
  if (code === "invalid_input") return "invalid_input";
  if (code === "already_submitted") return "already_submitted";
  return "unavailable";
}

function mapVoteError(
  code: Extract<SetFeatureRequestVoteResult, { ok: false }>["code"],
): FeatureRequestActionError {
  if (code === "not_found") return "not_found";
  if (code === "merged") return "merged";
  return "unavailable";
}

export async function runSubmitFeatureRequest(
  deps: FeatureRequestActionDeps,
  input: SubmitFeatureRequestActionInput,
): Promise<SubmitFeatureRequestActionResult> {
  // Auth first: an unauthenticated caller must not reach the service layer or
  // consume another account's rate-limit budget.
  const userId = await deps.getUserId();
  if (!userId) return { ok: false, error: "unauthenticated" };

  const parsed = submitInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_input" };

  try {
    const limit = await deps.checkRateLimit(
      `user:${userId}`,
      SUBMIT_RATE_LIMIT,
    );
    if (!limit.allowed) return { ok: false, error: "rate_limited" };

    const ipLimit = await deps.checkRateLimit(
      await deps.getClientIp(),
      SUBMIT_IP_RATE_LIMIT,
    );
    if (!ipLimit.allowed) return { ok: false, error: "rate_limited" };

    const result = await deps.submitFeatureRequest({ ...parsed.data, userId });
    if (result.ok) return { ok: true, id: result.id };
    return { ok: false, error: mapSubmitError(result.code) };
  } catch (error) {
    console.error("[feature-requests:submit]", error);
    return { ok: false, error: "unavailable" };
  }
}

export async function runSetFeatureRequestVote(
  deps: FeatureRequestActionDeps,
  input: SetFeatureRequestVoteActionInput,
): Promise<SetFeatureRequestVoteActionResult> {
  const userId = await deps.getUserId();
  if (!userId) return { ok: false, error: "unauthenticated" };

  const parsed = voteInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_input" };

  try {
    const limit = await deps.checkRateLimit(`user:${userId}`, VOTE_RATE_LIMIT);
    if (!limit.allowed) return { ok: false, error: "rate_limited" };

    const result = await deps.setFeatureRequestVote(
      parsed.data.requestId,
      userId,
      parsed.data.voted,
    );
    if (result.ok)
      return { ok: true, count: result.count, voted: result.voted };
    return { ok: false, error: mapVoteError(result.code) };
  } catch (error) {
    console.error("[feature-requests:vote]", error);
    return { ok: false, error: "unavailable" };
  }
}

export async function runGetMyVotedRequestIds(
  deps: FeatureRequestActionDeps,
): Promise<GetMyVotedRequestIdsActionResult> {
  const userId = await deps.getUserId();
  // Signed-out visitors see the board with nothing highlighted, which is not an
  // error state — but the caller still needs to distinguish it from an outage.
  if (!userId) return { ok: false, error: "unauthenticated" };

  try {
    return { ok: true, requestIds: await deps.getMyVotedRequestIds(userId) };
  } catch (error) {
    console.error("[feature-requests:my-votes]", error);
    return { ok: false, error: "unavailable" };
  }
}
