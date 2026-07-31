import type { Database } from "@/lib/supabase/database.types";
import { createServiceClient } from "@/lib/supabase/server";

type FeatureRequestRow =
  Database["public"]["Tables"]["feature_requests"]["Row"];
type FeatureRequestVoteRow =
  Database["public"]["Tables"]["feature_request_votes"]["Row"];

export type FeatureRequestStatus =
  "open" | "planned" | "in_progress" | "shipped" | "declined" | "duplicate";

const FEATURE_REQUEST_I18N_KEYS_BY_TITLE = {
  "Add reviews and ratings to brand pages": "brand_reviews",
  "Browse Taiwanese brands by occasion": "occasion_discovery",
  "Show nearby Taiwanese brands on a map": "nearby_brand_map",
  "Let brand owners claim and manage their brand page": "owner_claim_flow",
} as const;

export type FeatureRequestI18nKey =
  (typeof FEATURE_REQUEST_I18N_KEYS_BY_TITLE)[keyof typeof FEATURE_REQUEST_I18N_KEYS_BY_TITLE];

/**
 * Public projection of a board entry. `submitted_by` and `guest_email` are
 * deliberately absent: those columns exist for moderation, abuse tracing, and
 * replying to a guest only, and this type is the single boundary that keeps
 * submitter identity off the wire. Adding a `submittedBy` or `guestEmail` field
 * here would leak an auth.users id or a personal email address into the RSC
 * payload of a fully public page — `rowToFeatureRequest omits submitted_by` and
 * `rowToFeatureRequest omits guest_email` pin that.
 */
export type FeatureRequest = {
  id: string;
  title: string;
  body: string | null;
  status: FeatureRequestStatus;
  voteCount: number;
  isSeed: boolean;
  i18nKey: FeatureRequestI18nKey | null;
  adminNote: string | null;
  mergedIntoId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ListFeatureRequestsOptions = {
  limit?: number;
};

/**
 * Who a vote belongs to. Exactly one identity, mirroring the table's
 * `num_nonnulls(user_id, visitor_hash) = 1` check: a guest has no auth.users
 * row to reference, and a signed-in voter must never be deduped by a cookie
 * that a browser can throw away.
 */
export type FeatureRequestVoter =
  | { userId: string; visitorHash?: never }
  | { visitorHash: string; userId?: never };

export type SubmitFeatureRequestInput = {
  title: string;
  body: string;
  userId: string | null;
  guestEmail?: string | null;
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
const MAX_BOARD_REQUESTS = 200;

/**
 * Length bounds for a submitted request. These are the single source of truth
 * for the dialog, the zod schema in `@/lib/actions/feature-requests-core`, and
 * this module's own guard — they must keep matching the migration's
 * `check (char_length(title) between 4 and 80)` and
 * `check (char_length(body) <= 2000)`, so changing one means changing both.
 *
 * `FEATURE_REQUEST_BODY_MIN` has no CHECK counterpart on purpose: the column
 * stays nullable because legacy rows were submitted before the body became
 * required, so the minimum is enforced app-side only.
 */
export const FEATURE_REQUEST_TITLE_MIN = 4;
export const FEATURE_REQUEST_TITLE_MAX = 80;
export const FEATURE_REQUEST_BODY_MIN = 10;
export const FEATURE_REQUEST_BODY_MAX = 2000;

/**
 * `.in()` serialises every id into the GET query string, so an unbounded id
 * list on a 200-row board produces a ~7.5 KB request line — past the 8 KB cap
 * that gateways commonly enforce, and postgrest-js has no POST fallback.
 * Batching keeps each request line small at the cost of at most four round
 * trips per board render.
 */
const VOTE_ID_BATCH_SIZE = 50;

const FEATURE_REQUEST_COLUMNS =
  "id, title, body, status, merged_into_id, is_seed, admin_note, created_at, updated_at";

const FEATURE_REQUEST_STATUSES: readonly FeatureRequestStatus[] = [
  "open",
  "planned",
  "in_progress",
  "shipped",
  "declined",
  "duplicate",
];

export function isFeatureRequestStatus(
  value: string,
): value is FeatureRequestStatus {
  return (FEATURE_REQUEST_STATUSES as readonly string[]).includes(value);
}

function seedI18nKey(title: string): FeatureRequestI18nKey | null {
  return (
    FEATURE_REQUEST_I18N_KEYS_BY_TITLE[
      title as keyof typeof FEATURE_REQUEST_I18N_KEYS_BY_TITLE
    ] ?? null
  );
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
    status: row.status as FeatureRequestStatus,
    voteCount,
    isSeed: row.is_seed,
    i18nKey: row.is_seed ? seedI18nKey(row.title) : null,
    adminNote: row.admin_note,
    mergedIntoId: row.merged_into_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Vote counts are aggregated in JS from one flat `request_id` select (batched
 * into `VOTE_ID_BATCH_SIZE` chunks to keep the GET query string under the
 * gateway limit) rather than a per-request count query, so a board render
 * costs one row query plus a small constant number of vote queries regardless
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
function compareFeatureRequests(a: FeatureRequest, b: FeatureRequest) {
  if (b.voteCount !== a.voteCount) return b.voteCount - a.voteCount;
  return b.createdAt.localeCompare(a.createdAt);
}

/**
 * Shared assembly: rows + vote rows -> ordered listing. Callers decide whether
 * merged tombstones reached this point; nothing here re-checks that, which is
 * why the public entry point below is a separate exported function.
 */
function assembleFeatureRequests(
  rows: FeatureRequestRow[],
  voteRows: Pick<FeatureRequestVoteRow, "request_id">[],
): FeatureRequest[] {
  const counts = countVotesByRequest(voteRows);

  return rows
    .map((row) => rowToFeatureRequest(row, counts.get(row.id) ?? 0))
    .sort(compareFeatureRequests);
}

/**
 * Pure assembly step for the public board: rows + vote rows -> ordered board
 * with two kinds of row dropped.
 *
 *   - merged tombstones, because they redirect to a target that is already on
 *     the board and their votes have moved there,
 *   - `declined` requests, because a decline is a decision that has already
 *     been made: the board exists to collect votes on what is still open, and
 *     keeping a closed decision on it advertises a "no" nobody can act on.
 *
 * Both filters live here rather than in a component because this function is
 * the single place that owns what reaches the public surface — a component
 * filter would be re-implemented by the next component that renders the board.
 * `assembleFeatureRequests` stays unfiltered on purpose so the admin queue can
 * still moderate declined rows. Extracted so the filtering and ordering rules
 * can be tested with no database and no mocks.
 */
export function buildFeatureRequestBoard(
  rows: FeatureRequestRow[],
  voteRows: Pick<FeatureRequestVoteRow, "request_id">[],
): FeatureRequest[] {
  return assembleFeatureRequests(
    rows.filter(
      (row) => row.merged_into_id === null && row.status !== "declined",
    ),
    voteRows,
  );
}

/**
 * Reads vote rows for a set of request ids in `VOTE_ID_BATCH_SIZE` batches, so
 * the id list never grows the GET query string past what gateways accept.
 */
async function fetchVoteRows(
  supabase: ReturnType<typeof createServiceClient>,
  requestIds: string[],
  voter?: FeatureRequestVoter,
): Promise<Pick<FeatureRequestVoteRow, "request_id">[]> {
  const batches: string[][] = [];
  for (let index = 0; index < requestIds.length; index += VOTE_ID_BATCH_SIZE) {
    batches.push(requestIds.slice(index, index + VOTE_ID_BATCH_SIZE));
  }

  const results = await Promise.all(
    batches.map(async (batch) => {
      let query = supabase
        .from("feature_request_votes")
        .select("request_id")
        .in("request_id", batch);
      if (voter) {
        query =
          voter.userId !== undefined
            ? query.eq("user_id", voter.userId)
            : query.eq("visitor_hash", voter.visitorHash);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as Pick<FeatureRequestVoteRow, "request_id">[];
    }),
  );

  return results.flat();
}

/**
 * The one query path behind both listings. `includeMerged` is a private
 * parameter on purpose: the public entry point below hard-codes `false`, so no
 * caller can flip tombstones onto the board.
 */
async function loadFeatureRequests(
  options: ListFeatureRequestsOptions,
  includeMerged: boolean,
): Promise<FeatureRequest[]> {
  const supabase = createServiceClient();
  const limit = Math.min(
    Math.max(1, Math.floor(options.limit ?? MAX_BOARD_REQUESTS)),
    MAX_BOARD_REQUESTS,
  );

  let query = supabase
    .from("feature_requests")
    .select(FEATURE_REQUEST_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (!includeMerged) query = query.is("merged_into_id", null);

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data ?? []) as unknown as FeatureRequestRow[];
  if (rows.length === 0) return [];

  // Batched flat selects for every visible request — never a count per row.
  const voteRows = await fetchVoteRows(
    supabase,
    rows.map((row) => row.id),
  );

  return includeMerged
    ? assembleFeatureRequests(rows, voteRows)
    : buildFeatureRequestBoard(rows, voteRows);
}

export async function listFeatureRequests(
  options: ListFeatureRequestsOptions = {},
): Promise<FeatureRequest[]> {
  return loadFeatureRequests(options, false);
}

/**
 * Moderation listing: every request, including the merged tombstones the
 * public board hides. Separate from `listFeatureRequests` on purpose — the
 * merged filter is a public-surface guarantee, and an `includeMerged` flag on
 * the public function would be one boolean away from leaking tombstones onto
 * the board.
 */
export async function listAllFeatureRequests(): Promise<FeatureRequest[]> {
  return loadFeatureRequests({}, true);
}

/**
 * The caller passes the ids currently on screen whenever it has them, which
 * keeps this to the votes that can actually be rendered. Without a scope it
 * falls back to a capped read — a user with more votes than the board can show
 * would otherwise drag their whole vote history across the wire.
 */
export async function getMyVotedRequestIds(
  voter: FeatureRequestVoter,
  requestIds?: string[],
): Promise<string[]> {
  const supabase = createServiceClient();

  if (requestIds) {
    if (requestIds.length === 0) return [];
    const rows = await fetchVoteRows(
      supabase,
      requestIds.slice(0, MAX_BOARD_REQUESTS),
      voter,
    );
    return rows.map((row) => row.request_id);
  }

  const scoped = supabase
    .from("feature_request_votes")
    .select("request_id")
    .limit(MAX_BOARD_REQUESTS);

  const { data, error } =
    voter.userId !== undefined
      ? await scoped.eq("user_id", voter.userId)
      : await scoped.eq("visitor_hash", voter.visitorHash);

  if (error) throw error;
  return ((data ?? []) as Pick<FeatureRequestVoteRow, "request_id">[]).map(
    (row) => row.request_id,
  );
}

/**
 * 23505 is `feature_requests_unique_title_idx` firing, not an outage — the
 * caller shows "that request is already on the board", never a retry prompt.
 * That index exists only as of the guest-submission migration; before it this
 * branch was unreachable. Exported so the mapping is pinned without a database
 * round-trip.
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
  const body = input.body.trim();

  if (
    title.length < FEATURE_REQUEST_TITLE_MIN ||
    title.length > FEATURE_REQUEST_TITLE_MAX
  ) {
    return { ok: false, code: "invalid_input" };
  }
  if (
    body.length < FEATURE_REQUEST_BODY_MIN ||
    body.length > FEATURE_REQUEST_BODY_MAX
  ) {
    return { ok: false, code: "invalid_input" };
  }
  // A signed-in submitter's address is already on their account, so a
  // `guestEmail` arriving alongside a `userId` is ignored rather than stored:
  // it would be an unverified second address attached to a known account.
  const guestEmail =
    input.userId === null ? input.guestEmail?.trim() || null : null;

  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("feature_requests")
      .insert({
        title,
        body,
        status: "open",
        submitted_by: input.userId,
        guest_email: guestEmail,
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
  voter: FeatureRequestVoter,
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

    // One vote row carries exactly one identity, matching the table's
    // `num_nonnulls(user_id, visitor_hash) = 1` check.
    const identity =
      voter.userId !== undefined
        ? { user_id: voter.userId }
        : { visitor_hash: voter.visitorHash };

    if (voted) {
      // Plain insert with 23505 swallowed, not an upsert: dedup now lives in
      // two PARTIAL unique indexes (one per identity column), and PostgREST
      // cannot reliably infer a partial index from an `onConflict` column
      // list. Swallowing the duplicate keeps the original contract — a second
      // click is a no-op, because vote/unvote is idempotent by design.
      const { error } = await supabase
        .from("feature_request_votes")
        .insert({ request_id: requestId, ...identity });
      if (error && error.code !== "23505") {
        return { ok: false, code: "database_error" };
      }
    } else {
      const deletion = supabase
        .from("feature_request_votes")
        .delete()
        .eq("request_id", requestId);
      const { error } =
        voter.userId !== undefined
          ? await deletion.eq("user_id", voter.userId)
          : await deletion.eq("visitor_hash", voter.visitorHash);
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

type VoteIdentityRow = Pick<FeatureRequestVoteRow, "user_id" | "visitor_hash">;

async function readVoteIdentities(
  supabase: ReturnType<typeof createServiceClient>,
  requestId: string,
): Promise<VoteIdentityRow[]> {
  const { data, error } = await supabase
    .from("feature_request_votes")
    .select("user_id, visitor_hash")
    .eq("request_id", requestId);

  if (error) throw error;
  return (data ?? []) as VoteIdentityRow[];
}

/**
 * Comparable key for "the same voter". Prefixed because an account id and a
 * visitor hash are different namespaces, and an unprefixed compare would let a
 * collision between them silently drop a vote during a merge.
 */
function voteIdentityKey(row: VoteIdentityRow): string {
  return row.user_id !== null
    ? `user:${row.user_id}`
    : `visitor:${row.visitor_hash}`;
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
 * the two partial unique indexes — `(request_id, user_id)` for accounts and
 * `(request_id, visitor_hash)` for guests. Marking the source last means
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
      readVoteIdentities(supabase, targetId),
      readVoteIdentities(supabase, sourceId),
    ]);
    const targetVoterSet = new Set(targetVoters.map(voteIdentityKey));
    const movable = sourceVoters.filter(
      (row) => !targetVoterSet.has(voteIdentityKey(row)),
    );

    // Step 1 — re-point the non-overlapping votes. Two statements, because a
    // guest vote and an account vote are matched on different columns and a
    // single `.in()` cannot span both.
    const movableUserIds = movable
      .map((row) => row.user_id)
      .filter((userId): userId is string => userId !== null);
    const movableVisitorHashes = movable
      .map((row) => row.visitor_hash)
      .filter((hash): hash is string => hash !== null);

    if (movableUserIds.length > 0) {
      const { error } = await supabase
        .from("feature_request_votes")
        .update({ request_id: targetId })
        .eq("request_id", sourceId)
        .in("user_id", movableUserIds);
      if (error) return { ok: false, code: "database_error" };
    }

    if (movableVisitorHashes.length > 0) {
      const { error } = await supabase
        .from("feature_request_votes")
        .update({ request_id: targetId })
        .eq("request_id", sourceId)
        .in("visitor_hash", movableVisitorHashes);
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
