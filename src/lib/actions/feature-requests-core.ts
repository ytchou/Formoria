import { z } from "zod/v3";

import type {
  RateLimitOptions,
  RateLimitResult,
} from "@/lib/security/rate-limiter";
import {
  FEATURE_REQUEST_BODY_MAX,
  FEATURE_REQUEST_BODY_MIN,
  FEATURE_REQUEST_TITLE_MAX,
  FEATURE_REQUEST_TITLE_MIN,
  type FeatureRequestVoter,
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
  /** Mints the anonymous-visitor cookie when absent — write paths only. */
  ensureVisitorHash: () => Promise<string>;
  /** Read-only companion: never mints, so a read cannot create an identity. */
  readVisitorHash: () => Promise<string | null>;
  checkRateLimit: (
    identifier: string,
    options: RateLimitOptions,
  ) => Promise<RateLimitResult>;
  submitFeatureRequest: typeof submitFeatureRequest;
  setFeatureRequestVote: typeof setFeatureRequestVote;
  getMyVotedRequestIds: typeof getMyVotedRequestIds;
};

// Bounds come from the service module so the schema, the service guard, the
// dialog, and the migration's CHECK constraints cannot drift apart. The body
// minimum is the one bound with no CHECK counterpart — the column stays
// nullable for legacy rows, so it is enforced app-side only.
const submitInputSchema = z.object({
  title: z
    .string()
    .trim()
    .min(FEATURE_REQUEST_TITLE_MIN)
    .max(FEATURE_REQUEST_TITLE_MAX),
  body: z
    .string()
    .trim()
    .min(FEATURE_REQUEST_BODY_MIN)
    .max(FEATURE_REQUEST_BODY_MAX),
  // Optional reply-to for a guest. The empty-string branch exists because a
  // controlled input sends "" for an untouched field, and an untouched optional
  // field must not fail the whole submission. Shaped like `optionalEmail` in
  // the brand-submission validations but declared here: that module is another
  // flow's boundary, and importing across it would couple the two schemas.
  guestEmail: z.string().email().or(z.literal("")).optional(),
});

const voteInputSchema = z.object({
  requestId: z.string().uuid(),
  voted: z.boolean(),
});

// Two-tier, because the board now takes guest writes and there is no longer a
// single identity to key on. Tier one is this budget, keyed by account when
// there is one and by IP when there is not, so a signed-in submitter is still
// not throttled by whoever shares their campus NAT. Tier two is
// `SUBMIT_IP_RATE_LIMIT` below, the per-host ceiling both paths pass through.
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

// Tier two: a per-host ceiling across every request on the board. Tier one is
// keyed on identity, and a guest who clears cookies gets a fresh one — this is
// the budget that a cookie-clearing loop actually has to spend.
const VOTE_IP_RATE_LIMIT = {
  windowMs: 3_600_000,
  maxRequests: 60,
  prefix: "feature-request-vote-ip",
} as const;

// Tier three, narrow and slow: one host can only push a single request so far
// in a day. Applied to added votes only — an unvote must stay free, or a
// mistaken click would cost a visitor their whole daily budget on that row.
// Ceiling: rotating IPs still get through; add a challenge if that shows up.
const VOTE_REQUEST_IP_RATE_LIMIT = {
  windowMs: 86_400_000,
  maxRequests: 5,
  prefix: "feature-request-vote-request-ip",
} as const;

// Secondary, deliberately loose cap on the one flow that creates rows. Tier one
// is the real gate; this raises the cost of farming throwaway accounts — or
// clearing cookies as a guest — from one host. Ceiling: a determined abuser on
// rotating IPs still gets through, for guests as much as for accounts; add a
// challenge or email-verification gate on the guest path if that happens.
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
  // No auth gate: the board takes guest submissions. The id is still read and
  // recorded whenever the submitter happens to be signed in.
  const userId = await deps.getUserId();

  const parsed = submitInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_input" };

  try {
    // One resolve, two uses: the guest path keys tier one on the same address
    // the per-host ceiling below uses.
    const clientIp = await deps.getClientIp();
    const identity = userId ? `user:${userId}` : `ip:${clientIp}`;

    const limit = await deps.checkRateLimit(identity, SUBMIT_RATE_LIMIT);
    if (!limit.allowed) return { ok: false, error: "rate_limited" };

    const ipLimit = await deps.checkRateLimit(clientIp, SUBMIT_IP_RATE_LIMIT);
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
  // No auth gate: the board takes guest votes. A signed-in voter keeps their
  // account identity; everyone else votes as the anonymous browser identity
  // behind the signed visitor cookie, which is minted here because this is a
  // write path.
  const userId = await deps.getUserId();

  const parsed = voteInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_input" };

  try {
    const voter: FeatureRequestVoter = userId
      ? { userId }
      : { visitorHash: await deps.ensureVisitorHash() };
    // One resolve, three uses, matching `runSubmitFeatureRequest`.
    const clientIp = await deps.getClientIp();

    const identity = voter.userId
      ? `user:${voter.userId}`
      : `visitor:${voter.visitorHash}`;
    const limit = await deps.checkRateLimit(identity, VOTE_RATE_LIMIT);
    if (!limit.allowed) return { ok: false, error: "rate_limited" };

    const ipLimit = await deps.checkRateLimit(clientIp, VOTE_IP_RATE_LIMIT);
    if (!ipLimit.allowed) return { ok: false, error: "rate_limited" };

    // Adds only: an unvote is a correction, and charging it here would let a
    // mis-click burn a visitor's whole daily budget on this request.
    if (parsed.data.voted) {
      const requestLimit = await deps.checkRateLimit(
        `${clientIp}:${parsed.data.requestId}`,
        VOTE_REQUEST_IP_RATE_LIMIT,
      );
      if (!requestLimit.allowed) return { ok: false, error: "rate_limited" };
    }

    const result = await deps.setFeatureRequestVote(
      parsed.data.requestId,
      voter,
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

  try {
    // Read-only identity resolution: a visitor with no cookie has never voted,
    // which is an empty result rather than an error — and minting a cookie for
    // a read would create a tracking identifier out of a page view.
    let voter: FeatureRequestVoter | null = null;
    if (userId) {
      voter = { userId };
    } else {
      const visitorHash = await deps.readVisitorHash();
      if (visitorHash) voter = { visitorHash };
    }
    if (!voter) return { ok: true, requestIds: [] };

    return { ok: true, requestIds: await deps.getMyVotedRequestIds(voter) };
  } catch (error) {
    console.error("[feature-requests:my-votes]", error);
    return { ok: false, error: "unavailable" };
  }
}
