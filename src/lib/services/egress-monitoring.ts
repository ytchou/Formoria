import { auditedCall } from "@/lib/audit";
import type { AgentNotification } from "@/lib/adapters/slack/notification";
import { assessUsageRisk, type UsageRisk } from "./operational-usage";

/**
 * Image-egress anomaly detection from Cloudflare zone analytics (DEV-1744,
 * task 5).
 *
 * `docs/runbooks/cloudflare-edge.md` ("Image egress anomaly monitoring") has
 * specified this watch since the edge-first work landed; it was never built,
 * and the gap is exactly what turned a known architecture choice into a
 * billing surprise. This module implements that section and nothing more.
 *
 * Cloudflare is the only telemetry source on purpose. The edge sees every
 * image byte leaving for a client, including the ones served from cache, which
 * is the number the runbook asks about. A second hosting-provider meter was
 * considered and rejected in PR #891 — two meters disagreeing is worse than
 * one meter you trust.
 *
 * Everything here is pure except `checkEgressAnomaly`, whose only side effect
 * is the injected `fetchImpl` call. It never throws: a monitoring path that
 * crashes, or that pages on its own failure, is a second incident rather than
 * a warning about the first.
 */

const GIGABYTE = 1024 ** 3;

/**
 * Daily cap, from the edge-first plan's Tweakable Decision 3 (5 GB/day, with
 * warning/critical at the 0.7/0.9 ratios `assessUsageRisk` already applies).
 * Observed baseline is 0.1–0.5 GB/day, so the cap sits an order of magnitude
 * above normal: it is an "something is wrong" line, not a budget.
 */
export const EGRESS_DAILY_LIMIT_BYTES = 5 * GIGABYTE;

/** Documented steady state, reported alongside the reading for context. */
export const EGRESS_BASELINE_GB_PER_DAY = { low: 0.1, high: 0.5 } as const;

/**
 * The two paths that serve image bytes: the same-origin proxy and Next's
 * image optimizer. Order is load-bearing only for the runbook's readability.
 */
export const MONITORED_EGRESS_PATH_PREFIXES = ["/i/", "/_next/image"] as const;

const QUERY_ALIASES = {
  proxiedImages: "/i/%",
  nextImages: "/_next/image%",
} as const;

const DEFAULT_WINDOW_DAYS = 7;
const REQUEST_TIMEOUT_MS = 15_000;
const CLOUDFLARE_GRAPHQL_ENDPOINT = "https://api.cloudflare.com/client/v4/graphql";

/**
 * `httpRequestsAdaptiveGroups` is the zone dataset that carries
 * `edgeResponseBytes` with a `clientRequestPath` filter. One aliased block per
 * monitored prefix, because a single block cannot express an OR across two
 * `_like` patterns.
 */
const EGRESS_BY_DAY_QUERY = `
query EgressBytesByDay($zoneTag: String!, $since: Date!, $until: Date!) {
  viewer {
    zones(filter: { zoneTag: $zoneTag }) {
      proxiedImages: httpRequestsAdaptiveGroups(
        limit: 1000
        orderBy: [date_ASC]
        filter: { date_geq: $since, date_leq: $until, clientRequestPath_like: "${QUERY_ALIASES.proxiedImages}" }
      ) {
        dimensions { date }
        sum { edgeResponseBytes }
      }
      nextImages: httpRequestsAdaptiveGroups(
        limit: 1000
        orderBy: [date_ASC]
        filter: { date_geq: $since, date_leq: $until, clientRequestPath_like: "${QUERY_ALIASES.nextImages}" }
      ) {
        dimensions { date }
        sum { edgeResponseBytes }
      }
    }
  }
}`;

export type EgressDay = { date: string; bytes: number };

export type EgressAnomalyReport = {
  /** `ready` means the numbers below are real; the other two mean they are not. */
  state: "ready" | "unconfigured" | "error";
  message: string | null;
  limitBytes: number;
  window: { since: string; until: string } | null;
  days: EgressDay[];
  worstDay: EgressDay | null;
  risk: UsageRisk;
  exceeded: boolean;
};

export type CheckEgressAnomalyOptions = {
  apiToken?: string;
  zoneId?: string;
  fetchImpl?: typeof fetch;
  now?: Date;
  windowDays?: number;
};

function utcDate(at: Date): string {
  return at.toISOString().slice(0, 10);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function graphqlErrorMessage(body: unknown): string | null {
  if (!isRecord(body)) return null;
  const errors = body.errors;
  if (!Array.isArray(errors) || errors.length === 0) return null;
  const messages = errors
    .map((entry) =>
      isRecord(entry) && typeof entry.message === "string" ? entry.message : null,
    )
    .filter((message): message is string => Boolean(message));
  return messages.length > 0 ? messages.join("; ") : "Unspecified GraphQL error";
}

/**
 * Folds every aliased group block into one bytes-per-day series, sorted by
 * date. Unknown aliases are summed too: adding a prefix to the query must not
 * require editing the parser.
 */
export function parseEgressBytesByDay(body: unknown): EgressDay[] {
  const totals = new Map<string, number>();

  const zones = isRecord(body) && isRecord(body.data) && isRecord(body.data.viewer)
    ? body.data.viewer.zones
    : null;
  if (!Array.isArray(zones)) return [];

  for (const zone of zones) {
    if (!isRecord(zone)) continue;
    for (const groups of Object.values(zone)) {
      if (!Array.isArray(groups)) continue;
      for (const group of groups) {
        if (!isRecord(group)) continue;
        const dimensions = isRecord(group.dimensions) ? group.dimensions : null;
        const date = dimensions && typeof dimensions.date === "string"
          ? dimensions.date
          : null;
        const sum = isRecord(group.sum) ? group.sum : null;
        const bytes = sum && typeof sum.edgeResponseBytes === "number"
          ? sum.edgeResponseBytes
          : 0;
        if (!date || !Number.isFinite(bytes)) continue;
        totals.set(date, (totals.get(date) ?? 0) + bytes);
      }
    }
  }

  return [...totals.entries()]
    .map(([date, bytes]) => ({ date, bytes }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function worstOf(days: readonly EgressDay[]): EgressDay | null {
  return days.reduce<EgressDay | null>(
    (worst, day) => (worst === null || day.bytes > worst.bytes ? day : worst),
    null,
  );
}

function degraded(
  state: "unconfigured" | "error",
  message: string,
  window: EgressAnomalyReport["window"],
): EgressAnomalyReport {
  return {
    state,
    message,
    limitBytes: EGRESS_DAILY_LIMIT_BYTES,
    window,
    days: [],
    worstDay: null,
    risk: "unknown",
    exceeded: false,
  };
}

/**
 * Reads the last `windowDays` complete UTC days of image-path egress and
 * compares the worst day against the daily cap.
 *
 * Complete days only: a partial today always reads low and would teach whoever
 * gets the alert that the number is unreliable.
 */
export async function checkEgressAnomaly(
  options: CheckEgressAnomalyOptions = {},
): Promise<EgressAnomalyReport> {
  const apiToken = (options.apiToken ?? process.env.CLOUDFLARE_API_TOKEN ?? "").trim();
  const zoneId = (options.zoneId ?? process.env.CLOUDFLARE_ZONE_ID ?? "").trim();
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const now = options.now ?? new Date();
  const windowDays = Math.max(1, options.windowDays ?? DEFAULT_WINDOW_DAYS);

  const dayMs = 24 * 60 * 60 * 1000;
  const until = new Date(now.getTime() - dayMs);
  const since = new Date(until.getTime() - (windowDays - 1) * dayMs);
  const window = { since: utcDate(since), until: utcDate(until) };

  if (!apiToken || !zoneId) {
    return degraded(
      "unconfigured",
      "Cloudflare zone analytics is not configured (CLOUDFLARE_API_TOKEN / CLOUDFLARE_ZONE_ID).",
      window,
    );
  }

  let body: unknown;
  try {
    body = await auditedCall(
      {
        provider: "cloudflare",
        operation: "zone_egress_by_day",
        kind: "external",
        meta: { endpoint: CLOUDFLARE_GRAPHQL_ENDPOINT, method: "POST" },
      },
      async (context) => {
        const response = await fetchImpl(CLOUDFLARE_GRAPHQL_ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            query: EGRESS_BY_DAY_QUERY,
            variables: { zoneTag: zoneId, since: window.since, until: window.until },
          }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        context.summary.httpStatus = response.status;

        let parsed: unknown = null;
        try {
          parsed = await response.json();
        } catch {
          parsed = null;
        }

        if (!response.ok) {
          const detail = graphqlErrorMessage(parsed);
          throw new Error(
            `Cloudflare analytics returned HTTP ${response.status}${detail ? `: ${detail}` : ""}.`,
          );
        }

        const graphqlError = graphqlErrorMessage(parsed);
        if (graphqlError) {
          throw new Error(`Cloudflare analytics error: ${graphqlError}.`);
        }

        return parsed;
      },
    );
  } catch (error) {
    return degraded(
      "error",
      error instanceof Error ? error.message : "Unknown Cloudflare analytics error.",
      window,
    );
  }

  const days = parseEgressBytesByDay(body);
  const worstDay = worstOf(days);

  return {
    state: "ready",
    message: null,
    limitBytes: EGRESS_DAILY_LIMIT_BYTES,
    window,
    days,
    worstDay,
    risk: assessUsageRisk({
      value: worstDay?.bytes ?? 0,
      limit: EGRESS_DAILY_LIMIT_BYTES,
      completeness: "exact",
      projection: null,
    }),
    exceeded: (worstDay?.bytes ?? 0) > EGRESS_DAILY_LIMIT_BYTES,
  };
}

function gb(bytes: number): string {
  return `${(bytes / GIGABYTE).toFixed(2)} GB`;
}

/**
 * The Slack message for the daily cron. A degraded read reports itself as
 * needing attention without claiming an egress incident — "I could not look"
 * and "the number is bad" are different sentences.
 */
export function buildEgressAnomalyNotification(
  report: EgressAnomalyReport,
): AgentNotification {
  const date = new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Taipei",
  });

  if (report.state !== "ready") {
    return {
      agent: "egress-anomaly-check",
      status: "needs_attention",
      date,
      summary: [
        report.state === "unconfigured"
          ? "Image egress monitoring is not configured — no reading taken."
          : "Could not read Cloudflare zone analytics — no reading taken.",
        report.message ?? "No detail available.",
      ],
    };
  }

  const worst = report.worstDay;
  const headline = worst
    ? `Peak image egress ${gb(worst.bytes)} on ${worst.date} (cap ${gb(report.limitBytes)}).`
    : `No image egress recorded between ${report.window?.since} and ${report.window?.until}.`;

  return {
    agent: "egress-anomaly-check",
    status: report.exceeded || report.risk === "critical" || report.risk === "warning"
      ? "needs_attention"
      : "success",
    date,
    summary: [
      headline,
      `Baseline ${EGRESS_BASELINE_GB_PER_DAY.low}–${EGRESS_BASELINE_GB_PER_DAY.high} GB/day across ${MONITORED_EGRESS_PATH_PREFIXES.join(" + ")}.`,
      `Risk: ${report.risk}.`,
    ],
    details: report.days.map((day) => `${day.date}: ${gb(day.bytes)}`),
  };
}
