import type { Database } from "@/lib/supabase/database.types";
import { createServiceClient } from "@/lib/supabase/server";

type FeatureRequestRow =
  Database["public"]["Tables"]["feature_requests"]["Row"];
type FeatureRequestVoteRow =
  Database["public"]["Tables"]["feature_request_votes"]["Row"];

export type FeatureRequestStatus =
  "open" | "planned" | "in_progress" | "shipped" | "declined" | "duplicate";

export type FeatureRequestCategory = "owner" | "visitor";

/**
 * Public projection of a board entry. `submitted_by` is deliberately absent:
 * the column exists for moderation and abuse tracing only, and this type is the
 * single boundary that keeps the submitter's auth.users id off the wire. Adding
 * a `submittedBy` field here would leak it into the RSC payload of a fully
 * public page — `rowToFeatureRequest omits submitted_by` pins that.
 */
export type FeatureRequest = {
  id: string;
  title: string;
  body: string | null;
  category: FeatureRequestCategory;
  status: FeatureRequestStatus;
  voteCount: number;
  isSeed: boolean;
  adminNote: string | null;
  mergedIntoId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ListFeatureRequestsOptions = {
  category?: FeatureRequestCategory;
  limit?: number;
};

export type SubmitFeatureRequestInput = {
  title: string;
  body?: string | null;
  category: FeatureRequestCategory;
  userId: string;
};

export type SubmitFeatureRequestResult =
  | { ok: true; id: string }
  | {
      ok: false;
      code: "invalid_input" | "already_submitted" | "database_error";
    };

export type SetFeatureRequestVoteResult =
  | { ok: true; count: number; voted: boolean }
  | {
      ok: false;
      code: "not_found" | "merged" | "database_error";
    };

export type SetFeatureRequestStatusResult =
  | { ok: true }
  | { ok: false; code: "invalid_status" | "not_found" | "database_error" };

export type MergeFeatureRequestsResult =
  | { ok: true; movedVotes: number }
  | {
      ok: false;
      code:
        "invalid_target" | "not_found" | "already_merged" | "database_error";
    };

/**
 * Hard cap on a single board render. The board is one page with no pagination,
 * so this doubles as the query cap and the render cap.
 */
export const MAX_BOARD_REQUESTS = 200;

const FEATURE_REQUEST_COLUMNS =
  "id, title, body, category, status, merged_into_id, is_seed, admin_note, created_at, updated_at";

const FEATURE_REQUEST_STATUSES: readonly FeatureRequestStatus[] = [
  "open",
  "planned",
  "in_progress",
  "shipped",
  "declined",
  "duplicate",
];

const FEATURE_REQUEST_CATEGORIES: readonly FeatureRequestCategory[] = [
  "owner",
  "visitor",
];

export function isFeatureRequestStatus(
  value: string,
): value is FeatureRequestStatus {
  return (FEATURE_REQUEST_STATUSES as readonly string[]).includes(value);
}

export function isFeatureRequestCategory(
  value: string,
): value is FeatureRequestCategory {
  return (FEATURE_REQUEST_CATEGORIES as readonly string[]).includes(value);
}

/**
 * Row -> public shape. Takes the vote count as an argument rather than reading
 * it, so the projection stays a pure function that is testable without a
 * database. Every field is listed explicitly — never spread the row.
 */
export function rowToFeatureRequest(
  row: FeatureRequestRow,
  voteCount: number,
): FeatureRequest {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    category: row.category as FeatureRequestCategory,
    status: row.status as FeatureRequestStatus,
    voteCount,
    isSeed: row.is_seed,
    adminNote: row.admin_note,
    mergedIntoId: row.merged_into_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Vote counts are aggregated in JS from one flat `request_id` select rather
 * than a per-request count query, so a board render costs 2 queries regardless
 * of how many requests are on it.
 *
 * Ceiling: this holds while the board stays under ~500 requests / ~50k vote
 * rows — past that the flat vote select is the dominant cost and should be
 * replaced by a denormalized `vote_count` column on `feature_requests`
 * maintained by an after-insert/delete trigger on `feature_request_votes`,
 * which turns the board back into a single indexed query.
 */
export function countVotesByRequest(
  voteRows: Pick<FeatureRequestVoteRow, "request_id">[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const { request_id } of voteRows) {
    counts.set(request_id, (counts.get(request_id) ?? 0) + 1);
  }
  return counts;
}

/**
 * Board order: most-wanted first, newest first on a tie. Sorting happens in JS
 * because the vote count itself is computed in JS.
 */
export function compareFeatureRequests(a: FeatureRequest, b: FeatureRequest) {
  if (b.voteCount !== a.voteCount) return b.voteCount - a.voteCount;
  return b.createdAt.localeCompare(a.createdAt);
}

/**
 * Pure assembly step: rows + vote rows -> ordered public board. Extracted so
 * the filtering and ordering rules can be tested with no database and no mocks.
 */
export function buildFeatureRequestBoard(
  rows: FeatureRequestRow[],
  voteRows: Pick<FeatureRequestVoteRow, "request_id">[],
  options: ListFeatureRequestsOptions = {},
): FeatureRequest[] {
  const counts = countVotesByRequest(voteRows);

  return rows
    .filter((row) => row.merged_into_id === null)
    .filter((row) => !options.category || row.category === options.category)
    .map((row) => rowToFeatureRequest(row, counts.get(row.id) ?? 0))
    .sort(compareFeatureRequests);
}

export async function listFeatureRequests(
  options: ListFeatureRequestsOptions = {},
): Promise<FeatureRequest[]> {
  const supabase = createServiceClient();
  const limit = Math.min(
    Math.max(1, Math.floor(options.limit ?? MAX_BOARD_REQUESTS)),
    MAX_BOARD_REQUESTS,
  );

  let query = supabase
    .from("feature_requests")
    .select(FEATURE_REQUEST_COLUMNS)
    .is("merged_into_id", null)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (options.category) query = query.eq("category", options.category);

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data ?? []) as unknown as FeatureRequestRow[];
  if (rows.length === 0) return [];

  // One flat select for every visible request — never a count per row.
  const { data: voteData, error: voteError } = await supabase
    .from("feature_request_votes")
    .select("request_id")
    .in(
      "request_id",
      rows.map((row) => row.id),
    );
  if (voteError) throw voteError;

  return buildFeatureRequestBoard(
    rows,
    (voteData ?? []) as Pick<FeatureRequestVoteRow, "request_id">[],
    options,
  );
}

/**
 * Moderation listing: every request, including the merged tombstones the
 * public board hides. Separate from `listFeatureRequests` on purpose — the
 * merged filter is a public-surface guarantee, and an `includeMerged` flag on
 * the public function would be one boolean away from leaking tombstones onto
 * the board.
 */
export async function listAllFeatureRequests(): Promise<FeatureRequest[]> {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("feature_requests")
    .select(FEATURE_REQUEST_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(MAX_BOARD_REQUESTS);

  if (error) throw error;

  const rows = (data ?? []) as unknown as FeatureRequestRow[];
  if (rows.length === 0) return [];

  const { data: voteData, error: voteError } = await supabase
    .from("feature_request_votes")
    .select("request_id")
    .in(
      "request_id",
      rows.map((row) => row.id),
    );
  if (voteError) throw voteError;

  const counts = countVotesByRequest(
    (voteData ?? []) as Pick<FeatureRequestVoteRow, "request_id">[],
  );

  return rows
    .map((row) => rowToFeatureRequest(row, counts.get(row.id) ?? 0))
    .sort(compareFeatureRequests);
}

export async function getMyVotedRequestIds(userId: string): Promise<string[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("feature_request_votes")
    .select("request_id")
    .eq("user_id", userId);

  if (error) throw error;
  return ((data ?? []) as Pick<FeatureRequestVoteRow, "request_id">[]).map(
    (row) => row.request_id,
  );
}

/**
 * 23505 is the dedup index firing, not an outage — the caller shows "you
 * already asked for this", never a retry prompt. Exported so the mapping is
 * pinned without a database round-trip.
 */
export function submitErrorCode(
  error: { code?: string } | null,
): "already_submitted" | "database_error" {
  return error?.code === "23505" ? "already_submitted" : "database_error";
}

export async function submitFeatureRequest(
  input: SubmitFeatureRequestInput,
): Promise<SubmitFeatureRequestResult> {
  const title = input.title.trim();
  const body = input.body?.trim() ?? null;

  if (title.length < 4 || title.length > 120) {
    return { ok: false, code: "invalid_input" };
  }
  if (body !== null && body.length > 2000) {
    return { ok: false, code: "invalid_input" };
  }
  if (!isFeatureRequestCategory(input.category)) {
    return { ok: false, code: "invalid_input" };
  }

  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("feature_requests")
      .insert({
        title,
        body: body || null,
        category: input.category,
        status: "open",
        submitted_by: input.userId,
      })
      .select("id")
      .single();

    if (error) return { ok: false, code: submitErrorCode(error) };
    if (!data || typeof data.id !== "string") {
      return { ok: false, code: "database_error" };
    }
    return { ok: true, id: data.id };
  } catch {
    return { ok: false, code: "database_error" };
  }
}

async function countVotes(
  supabase: ReturnType<typeof createServiceClient>,
  requestId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from("feature_request_votes")
    .select("id", { count: "exact", head: true })
    .eq("request_id", requestId);

  if (error) throw error;
  return count ?? 0;
}

export async function setFeatureRequestVote(
  requestId: string,
  userId: string,
  voted: boolean,
): Promise<SetFeatureRequestVoteResult> {
  try {
    const supabase = createServiceClient();
    const { data: request, error: readError } = await supabase
      .from("feature_requests")
      .select("id, merged_into_id")
      .eq("id", requestId)
      .maybeSingle();

    if (readError) return { ok: false, code: "database_error" };
    if (!request) return { ok: false, code: "not_found" };
    // A merged request is a tombstone: it no longer renders on the board, so a
    // vote landing on it would be invisible and would be deleted by the next
    // merge. Send the caller to the target instead.
    if (request.merged_into_id) return { ok: false, code: "merged" };

    if (voted) {
      // ignoreDuplicates makes the second click a no-op instead of a 23505 —
      // vote/unvote is idempotent by design.
      const { error } = await supabase
        .from("feature_request_votes")
        .upsert(
          { request_id: requestId, user_id: userId },
          { onConflict: "request_id,user_id", ignoreDuplicates: true },
        );
      if (error) return { ok: false, code: "database_error" };
    } else {
      const { error } = await supabase
        .from("feature_request_votes")
        .delete()
        .eq("request_id", requestId)
        .eq("user_id", userId);
      if (error) return { ok: false, code: "database_error" };
    }

    return { ok: true, count: await countVotes(supabase, requestId), voted };
  } catch {
    return { ok: false, code: "database_error" };
  }
}

export async function setFeatureRequestStatus(
  requestId: string,
  status: FeatureRequestStatus,
  adminNote?: string | null,
): Promise<SetFeatureRequestStatusResult> {
  if (!isFeatureRequestStatus(status)) {
    return { ok: false, code: "invalid_status" };
  }

  try {
    const supabase = createServiceClient();
    const patch: Record<string, unknown> = {
      status,
      updated_at: new Date().toISOString(),
    };
    if (adminNote !== undefined) patch.admin_note = adminNote;

    const { error, count } = await supabase
      .from("feature_requests")
      .update(patch, { count: "exact" })
      .eq("id", requestId);

    if (error) return { ok: false, code: "database_error" };
    if (count === 0) return { ok: false, code: "not_found" };
    return { ok: true };
  } catch {
    return { ok: false, code: "database_error" };
  }
}

async function readVoterIds(
  supabase: ReturnType<typeof createServiceClient>,
  requestId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("feature_request_votes")
    .select("user_id")
    .eq("request_id", requestId);

  if (error) throw error;
  return ((data ?? []) as Pick<FeatureRequestVoteRow, "user_id">[]).map(
    (row) => row.user_id,
  );
}

/**
 * Folds `sourceId` into `targetId`. The write order is load-bearing and must
 * not be reordered:
 *
 *   1. re-point the source votes whose voter has NOT already voted on the
 *      target,
 *   2. delete the source votes that are left (the overlapping voters),
 *   3. mark the source merged.
 *
 * Re-pointing before deleting is what keeps a vote from being lost; excluding
 * the overlapping voters from step 1 is what keeps step 1 from colliding with
 * the `(request_id, user_id)` unique constraint. Marking the source last means
 * a crash mid-merge leaves a still-visible source with its votes intact, which
 * is re-runnable — marking it first would hide a request whose votes had not
 * moved yet.
 */
export async function mergeFeatureRequests(
  sourceId: string,
  targetId: string,
): Promise<MergeFeatureRequestsResult> {
  if (sourceId === targetId) return { ok: false, code: "invalid_target" };

  try {
    const supabase = createServiceClient();
    const { data: rows, error: readError } = await supabase
      .from("feature_requests")
      .select("id, merged_into_id")
      .in("id", [sourceId, targetId]);

    if (readError) return { ok: false, code: "database_error" };

    const loaded = (rows ?? []) as Pick<
      FeatureRequestRow,
      "id" | "merged_into_id"
    >[];
    const source = loaded.find((row) => row.id === sourceId);
    const target = loaded.find((row) => row.id === targetId);

    if (!source || !target) return { ok: false, code: "not_found" };
    if (source.merged_into_id) return { ok: false, code: "already_merged" };
    // Merging into a tombstone would chain redirects and hide the votes.
    if (target.merged_into_id) return { ok: false, code: "invalid_target" };

    const [targetVoters, sourceVoters] = await Promise.all([
      readVoterIds(supabase, targetId),
      readVoterIds(supabase, sourceId),
    ]);
    const targetVoterSet = new Set(targetVoters);
    const movable = sourceVoters.filter(
      (userId) => !targetVoterSet.has(userId),
    );

    // Step 1 — re-point the non-overlapping votes.
    if (movable.length > 0) {
      const { error } = await supabase
        .from("feature_request_votes")
        .update({ request_id: targetId })
        .eq("request_id", sourceId)
        .in("user_id", movable);
      if (error) return { ok: false, code: "database_error" };
    }

    // Step 2 — drop whatever is still pointing at the source (the overlap).
    const { error: deleteError } = await supabase
      .from("feature_request_votes")
      .delete()
      .eq("request_id", sourceId);
    if (deleteError) return { ok: false, code: "database_error" };

    // Step 3 — tombstone the source.
    const { error: markError } = await supabase
      .from("feature_requests")
      .update({
        merged_into_id: targetId,
        status: "duplicate",
        updated_at: new Date().toISOString(),
      })
      .eq("id", sourceId);
    if (markError) return { ok: false, code: "database_error" };

    return { ok: true, movedVotes: movable.length };
  } catch {
    return { ok: false, code: "database_error" };
  }
}
