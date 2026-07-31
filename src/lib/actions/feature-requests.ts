"use server";

import { headers } from "next/headers";

import { getClientIpFromHeaders, rateLimit } from "@/lib/security/rate-limiter";
import {
  getMyVotedRequestIds,
  setFeatureRequestVote,
  submitFeatureRequest,
} from "@/lib/services/feature-requests";
import { createClient } from "@/lib/supabase/server";

import { ensureVisitorHash, readVisitorHash } from "./visitor-identity";
import {
  runGetMyVotedRequestIds,
  runSetFeatureRequestVote,
  runSubmitFeatureRequest,
  type FeatureRequestActionDeps,
  type GetMyVotedRequestIdsActionResult,
  type SetFeatureRequestVoteActionInput,
  type SetFeatureRequestVoteActionResult,
  type SubmitFeatureRequestActionInput,
  type SubmitFeatureRequestActionResult,
} from "./feature-requests-core";

/**
 * Real wiring for the action logic in `./feature-requests-core`. Kept as the
 * only thing in the `"use server"` module so the exported surface is exactly
 * the three actions — a Server Action's arguments come from the client, so the
 * dependency seam must never appear in an exported signature.
 */
const deps: FeatureRequestActionDeps = {
  getUserId: async () => {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user?.id ?? null;
  },
  getClientIp: async () => getClientIpFromHeaders(await headers()),
  ensureVisitorHash,
  readVisitorHash,
  checkRateLimit: rateLimit,
  submitFeatureRequest,
  setFeatureRequestVote,
  getMyVotedRequestIds,
};

export async function submitFeatureRequestAction(
  input: SubmitFeatureRequestActionInput,
): Promise<SubmitFeatureRequestActionResult> {
  return runSubmitFeatureRequest(deps, input);
}

export async function setFeatureRequestVoteAction(
  input: SetFeatureRequestVoteActionInput,
): Promise<SetFeatureRequestVoteActionResult> {
  return runSetFeatureRequestVote(deps, input);
}

export async function getMyVotedRequestIdsAction(): Promise<GetMyVotedRequestIdsActionResult> {
  return runGetMyVotedRequestIds(deps);
}
