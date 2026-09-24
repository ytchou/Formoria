/**
 * E2E dispatch client — used by the staging e2e agent to claim a pending
 * ops-bot dispatch from production and to report its completion.
 *
 * Endpoint: POST <E2E_DISPATCH_URL>/api/internal/e2e-dispatch with
 * `Authorization: Bearer <E2E_DISPATCH_SECRET>`. E2E_DISPATCH_URL is the
 * production Railway origin (not the Cloudflare-fronted public host).
 *
 * Every function here never throws. Any failure resolves to "no dispatch", so
 * the agent falls back to posting in SLACK_E2E_CHANNEL (cron mode).
 */

import { auditedCall } from "@/lib/audit";
import { normalizeBaseUrl, scrubError } from "@/lib/adapters/internal-http";
import type { DispatchOutcome } from "@/lib/services/ops-agent/types";

export type { DispatchOutcome };

const TIMEOUT_MS = 5_000;
const DISPATCH_PATH = "/api/internal/e2e-dispatch";

export type ClaimedDispatch = {
  id: string;
  channelId: string;
  threadTs: string;
  requesterId: string;
};

export type ClaimResult = { dispatch: ClaimedDispatch | null; reason?: string };

export type CompleteResult =
  | { ok: true; updated: boolean }
  | { ok: false; reason: string };

type Endpoint = { url: string; secret: string };

type PostOutcome =
  | { ok: true; body: unknown }
  | { ok: false; reason: string; status?: number };

function resolveEndpoint(): Endpoint | null {
  // Railway shows the origin without a scheme, so the env var often arrives as
  // a bare host. normalizeBaseUrl defaults the scheme to https.
  const baseUrl = normalizeBaseUrl(process.env.E2E_DISPATCH_URL);
  const secret = process.env.E2E_DISPATCH_SECRET?.trim();
  if (!baseUrl || !secret) return null;
  return { url: `${baseUrl}${DISPATCH_PATH}`, secret };
}

function isTimeout(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  );
}

async function postDispatch(
  endpoint: Endpoint,
  body: Record<string, unknown>,
): Promise<PostOutcome> {
  try {
    const response = await fetch(endpoint.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${endpoint.secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      return {
        ok: false,
        reason: `http-${response.status}`,
        status: response.status,
      };
    }
    return { ok: true, body: (await response.json()) as unknown };
  } catch (error) {
    return { ok: false, reason: isTimeout(error) ? "timeout" : scrubError(error) };
  }
}

function parseDispatch(value: unknown): ClaimedDispatch | null | undefined {
  if (value === null) return null;
  if (typeof value !== "object") return undefined;
  const candidate = value as Record<string, unknown>;
  const { id, channelId, threadTs, requesterId } = candidate;
  if (
    typeof id !== "string" ||
    typeof channelId !== "string" ||
    typeof threadTs !== "string" ||
    typeof requesterId !== "string" ||
    !id ||
    !channelId ||
    !threadTs
  ) {
    return undefined;
  }
  return { id, channelId, threadTs, requesterId };
}

/**
 * Claims the oldest pending dispatch for this run. Resolves to
 * `{dispatch:null, reason}` on any failure; never throws.
 */
export async function claimDispatch(runId: string): Promise<ClaimResult> {
  const endpoint = resolveEndpoint();
  if (!endpoint) return { dispatch: null, reason: "unconfigured" };

  try {
    return await auditedCall(
      {
        provider: "ops-dispatch",
        operation: "claim_dispatch",
        kind: "external",
        meta: { runId },
      },
      async (ctx): Promise<ClaimResult> => {
        const result = await postDispatch(endpoint, { action: "claim", runId });
        if (!result.ok) {
          ctx.summary.reason = result.reason;
          if (result.status === 401) {
            // Distinct marker: a secret mismatch silently turns every
            // requested run into a cron-mode run, so make it greppable.
            console.warn(
              `[ops-dispatch] claim=unauthorized run=${runId} — E2E_DISPATCH_SECRET does not match production`,
            );
          } else {
            console.warn(
              `[ops-dispatch] claim failed run=${runId}: ${result.reason}`,
            );
          }
          return { dispatch: null, reason: result.reason };
        }

        const dispatch = parseDispatch(
          (result.body as { dispatch?: unknown } | null)?.dispatch,
        );
        if (dispatch === undefined) {
          ctx.summary.reason = "invalid-response";
          console.warn(`[ops-dispatch] claim returned an invalid body run=${runId}`);
          return { dispatch: null, reason: "invalid-response" };
        }
        ctx.summary.claimed = dispatch !== null;
        if (dispatch) ctx.summary.dispatchId = dispatch.id;
        return { dispatch };
      },
      { classify: (r) => (r.reason ? "failed" : "succeeded") },
    );
  } catch (error) {
    const reason = scrubError(error);
    console.warn(`[ops-dispatch] claim failed run=${runId}: ${reason}`);
    return { dispatch: null, reason };
  }
}

/**
 * Reports the run's outcome for a claimed dispatch. Never throws — if this
 * fails, the production lease expires and frees the in-flight guard.
 */
export async function completeDispatch(params: {
  dispatchId: string;
  runId: string;
  outcome: DispatchOutcome;
}): Promise<CompleteResult> {
  const endpoint = resolveEndpoint();
  if (!endpoint) return { ok: false, reason: "unconfigured" };

  try {
    return await auditedCall(
      {
        provider: "ops-dispatch",
        operation: "complete_dispatch",
        kind: "external",
        meta: { ...params },
      },
      async (ctx): Promise<CompleteResult> => {
        const result = await postDispatch(endpoint, {
          action: "complete",
          dispatchId: params.dispatchId,
          runId: params.runId,
          outcome: params.outcome,
        });
        if (!result.ok) {
          ctx.summary.reason = result.reason;
          console.warn(
            `[ops-dispatch] complete failed dispatch=${params.dispatchId}: ${result.reason}`,
          );
          return { ok: false, reason: result.reason };
        }
        const updated =
          (result.body as { updated?: unknown } | null)?.updated === true;
        ctx.summary.updated = updated;
        return { ok: true, updated };
      },
      { classify: (r) => (r.ok ? "succeeded" : "failed") },
    );
  } catch (error) {
    const reason = scrubError(error);
    console.warn(
      `[ops-dispatch] complete failed dispatch=${params.dispatchId}: ${reason}`,
    );
    return { ok: false, reason };
  }
}
