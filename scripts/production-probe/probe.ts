import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

import { boundedSlackText } from "@/lib/adapters/slack/notification";

import {
  requiredEnvironment,
  type ScriptEnvironment,
} from "../shared/environment";

export type ProbeVerdict = "down" | "gated" | "ok";

export type NotificationKind = "down" | "heartbeat" | "recovered";

export interface CheckResult {
  /** Raw response body, used only to recognise the maintenance gate. */
  body: string;
  id: string;
  ok: boolean;
  /**
   * Short operator-facing explanation for a failure the status code alone does
   * not explain — a 200 that is degraded or unreadable reads as healthy without
   * it.
   */
  reason?: string;
  /** null when the request never produced a response. */
  status: number | null;
}

export interface ProbeEvaluation {
  checkCount: number;
  /** Every non-ok result, including maintenance-gated ones. */
  failed: readonly CheckResult[];
  /** The non-ok results that are not the maintenance gate — these set `down`. */
  hardFailures: readonly CheckResult[];
  verdict: ProbeVerdict;
}

export interface ProbeState {
  lastHeartbeatDate: string | null;
  since: string;
  verdict: ProbeVerdict;
}

export interface ProbeDecision {
  kind: NotificationKind | null;
  state: ProbeState;
}

export interface RenderMessageInput {
  evaluation: ProbeEvaluation;
  kind: NotificationKind;
  now: Date;
  previous: ProbeState | null;
}

/**
 * Cloudflare answers curl's default fingerprint with 403, so every outbound
 * request from this probe must look like a browser. Verified 2026-08-22.
 */
export const PROBE_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

const HEARTBEAT_HOUR_UTC = 21;
const ATTEMPTS = 3;
const RETRY_DELAY_MS = 10_000;
const REQUEST_TIMEOUT_MS = 20_000;
const DAY_MS = 86_400_000;

// ── Pure decision layer ──────────────────────────────────────────────────────

function isMaintenanceGate(result: CheckResult): boolean {
  if (result.status !== 503) return false;
  try {
    const body: unknown = JSON.parse(result.body);
    return (
      typeof body === "object" &&
      body !== null &&
      (body as { error?: unknown }).error === "service_unavailable"
    );
  } catch {
    return false;
  }
}

export function evaluateProbe(
  results: readonly CheckResult[],
): ProbeEvaluation {
  const failed = results.filter((result) => !result.ok);
  const hardFailures = failed.filter((result) => !isMaintenanceGate(result));
  const verdict: ProbeVerdict =
    hardFailures.length > 0 ? "down" : failed.length > 0 ? "gated" : "ok";
  return { checkCount: results.length, failed, hardFailures, verdict };
}

function utcDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function shouldNotify(
  evaluation: ProbeEvaluation,
  previous: ProbeState | null,
  now: Date,
): ProbeDecision {
  const verdict = evaluation.verdict;
  const changed = previous !== null && previous.verdict !== verdict;
  const since = changed || previous === null ? now.toISOString() : previous.since;
  const lastHeartbeatDate = previous?.lastHeartbeatDate ?? null;
  const base: ProbeState = { lastHeartbeatDate, since, verdict };

  // A missing previous state means the first run ever, or a lost cache. There
  // is no transition to report, so a healthy or gated first run stays silent —
  // but a first run that finds production down must still alarm. Recording
  // `down` silently would make every later run see an unchanged verdict, so the
  // outage would never be reported at all.
  if (previous === null) {
    return { kind: verdict === "down" ? "down" : null, state: base };
  }

  if (changed && verdict === "down") return { kind: "down", state: base };
  // A down -> gated transition also lands here. It is a real transition worth
  // reporting, but it is not an all-clear; renderMessage qualifies the text.
  if (changed && previous.verdict === "down")
    return { kind: "recovered", state: base };

  // The heartbeat normally fires in a fixed evening window. GitHub drops and
  // delays scheduled runs, so a recorded date older than yesterday is made up
  // on the next run at any hour — a silent channel must mean a dead watcher,
  // never a skipped day. `lastHeartbeatDate !== today` keeps it to one per day.
  const today = utcDate(now);
  const yesterday = utcDate(new Date(now.getTime() - DAY_MS));
  const stale = lastHeartbeatDate !== null && lastHeartbeatDate < yesterday;
  const heartbeatDue =
    verdict !== "down" &&
    lastHeartbeatDate !== today &&
    (stale || now.getUTCHours() >= HEARTBEAT_HOUR_UTC);
  if (heartbeatDue) {
    return {
      kind: "heartbeat",
      state: { ...base, lastHeartbeatDate: today },
    };
  }

  return { kind: null, state: base };
}

function statusLabel(result: CheckResult): string {
  return result.status === null ? "no response" : String(result.status);
}

function checkLine(result: CheckResult): string {
  const reason = result.reason ? ` (${result.reason})` : "";
  return `• ${result.id} — ${statusLabel(result)}${reason}`;
}

function durationLabel(fromIso: string, now: Date): string {
  const start = Date.parse(fromIso);
  if (!Number.isFinite(start)) return "unknown duration";
  const minutes = Math.max(0, Math.round((now.getTime() - start) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}m`;
}

export function renderMessage(input: RenderMessageInput): string {
  const { evaluation, kind, now, previous } = input;
  const stamp = now.toISOString();

  if (kind === "down") {
    // Only the hard failures set the verdict. While the site sits behind the
    // maintenance gate, three checks return 503 on every run; listing them as
    // failures would bury the check that actually broke.
    const causes =
      evaluation.hardFailures.length > 0
        ? evaluation.hardFailures
        : evaluation.failed;
    return boundedSlackText(
      [
        `🔴 Production probe failed (${causes.length}/${evaluation.checkCount} checks) at ${stamp}`,
        ...causes.map(checkLine),
      ].join("\n"),
    );
  }

  if (kind === "recovered") {
    const outage = previous ? durationLabel(previous.since, now) : "unknown";
    if (evaluation.verdict === "gated") {
      return boundedSlackText(
        `⚠️ Production probe no longer failing at ${stamp} after ${outage} down, but the site is now behind the maintenance page and is not serving.`,
      );
    }
    return boundedSlackText(
      `✅ Production probe recovered at ${stamp} after ${outage} down.`,
    );
  }

  const gateNote =
    evaluation.verdict === "gated"
      ? "the site is currently gated behind the maintenance page"
      : "the site is serving normally";
  return boundedSlackText(
    `✅ Production probe daily heartbeat — ${evaluation.checkCount} checks run at ${stamp}; ${gateNote}.`,
  );
}

// ── Side-effecting layer ─────────────────────────────────────────────────────

export type ProbeEnvironment = ScriptEnvironment;

export function readState(path: string): ProbeState | null {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const candidate = parsed as Partial<ProbeState>;
    if (
      candidate.verdict !== "ok" &&
      candidate.verdict !== "down" &&
      candidate.verdict !== "gated"
    ) {
      return null;
    }
    // A missing `since` is a shape failure like any other. Substituting the
    // Unix epoch rendered recovery messages as a ~490,000h outage.
    if (typeof candidate.since !== "string") return null;
    return {
      lastHeartbeatDate:
        typeof candidate.lastHeartbeatDate === "string"
          ? candidate.lastHeartbeatDate
          : null,
      since: candidate.since,
      verdict: candidate.verdict,
    };
  } catch {
    return null;
  }
}

export function writeState(path: string, state: ProbeState): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`);
}

async function request(
  id: string,
  url: string,
  headers: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<CheckResult> {
  try {
    const response = await fetchImpl(url, {
      headers: { "User-Agent": PROBE_USER_AGENT, ...headers },
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    let body: string;
    let bodyReadable = true;
    try {
      body = await response.text();
    } catch {
      body = "";
      bodyReadable = false;
    }
    return {
      body,
      id,
      ok: response.ok,
      status: response.status,
      ...(bodyReadable ? {} : { reason: "response body unreadable" }),
    };
  } catch {
    return { body: "", id, ok: false, status: null };
  }
}

/**
 * A 2xx from `/api/health` is not evidence of health: the 2026-08-13 outage
 * served 200 with `rateLimitStore: "degraded"`. A body that will not parse is
 * not evidence either, but it is a different failure and says so, because
 * `health — 200` alone told the operator nothing.
 */
export function classifyHealthResult(result: CheckResult): CheckResult {
  if (!result.ok) return result;
  if (result.reason) return { ...result, ok: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.body);
  } catch {
    return { ...result, ok: false, reason: "health body unreadable" };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { ...result, ok: false, reason: "health body unreadable" };
  }
  if ((parsed as { rateLimitStore?: unknown }).rateLimitStore === "degraded") {
    return { ...result, ok: false, reason: "rate limiter degraded" };
  }
  return result;
}

export async function collectChecks(
  config: {
    baseUrl: string;
    supabaseAnonKey: string;
    supabaseUrl: string;
  },
  fetchImpl: typeof fetch,
): Promise<CheckResult[]> {
  const base = config.baseUrl.replace(/\/+$/, "");
  const supabase = config.supabaseUrl.replace(/\/+$/, "");

  // Concurrent, so the four checks describe the same instant and a total
  // outage costs one request timeout rather than four. The destructuring keeps
  // the reported order stable.
  const [home, brands, healthResponse, supabaseCheck] = await Promise.all([
    request("home", `${base}/`, {}, fetchImpl),
    // Never probe /brands/<slug>: that prefix sits behind the Turnstile
    // soft-limit in proxy.ts, so a slug path would measure the challenge, not
    // the site.
    request("brands", `${base}/brands`, {}, fetchImpl),
    request("health", `${base}/api/health`, {}, fetchImpl),
    request(
      "supabase",
      `${supabase}/rest/v1/brands?select=id&limit=1`,
      {
        Authorization: `Bearer ${config.supabaseAnonKey}`,
        apikey: config.supabaseAnonKey,
      },
      fetchImpl,
    ),
  ]);

  return [home, brands, classifyHealthResult(healthResponse), supabaseCheck];
}

async function postSlack(
  webhookUrl: string,
  text: string,
  fetchImpl: typeof fetch,
): Promise<void> {
  const response = await fetchImpl(webhookUrl, {
    body: JSON.stringify({ text }),
    headers: {
      "Content-Type": "application/json",
      "User-Agent": PROBE_USER_AGENT,
    },
    method: "POST",
  });
  if (!response.ok) {
    const error = new Error(`Slack webhook returned HTTP ${response.status}`);
    error.name = "SlackDeliveryFailed";
    throw error;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function resolveStatePath(
  environment: ProbeEnvironment,
  argv: readonly string[],
): string {
  const fromArgv = argv[2]?.trim();
  if (fromArgv) return fromArgv;
  const fromEnv = environment.PROBE_STATE_PATH?.trim();
  return fromEnv || ".probe-state/production-probe.json";
}

export async function main(
  dependencies: {
    argv?: readonly string[];
    env?: ProbeEnvironment;
    fetchImpl?: typeof fetch;
    now?: () => Date;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<ProbeDecision> {
  const environment = dependencies.env ?? process.env;
  const fetchImpl = dependencies.fetchImpl ?? globalThis.fetch;
  const now = dependencies.now ?? (() => new Date());
  const sleep = dependencies.sleep ?? delay;
  const argv = dependencies.argv ?? process.argv;

  const baseUrl = requiredEnvironment(environment, "PRODUCTION_BASE_URL");
  const supabaseUrl = requiredEnvironment(environment, "NEXT_PUBLIC_SUPABASE_URL");
  const supabaseAnonKey = requiredEnvironment(
    environment,
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  );
  const webhookUrl = requiredEnvironment(environment, "SLACK_HEALTH_WEBHOOK_URL");

  let evaluation = evaluateProbe([]);
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const results = await collectChecks(
      { baseUrl, supabaseAnonKey, supabaseUrl },
      fetchImpl,
    );
    evaluation = evaluateProbe(results);
    if (evaluation.verdict !== "down") break;
    if (attempt < ATTEMPTS - 1) await sleep(RETRY_DELAY_MS);
  }

  const statePath = resolveStatePath(environment, argv);
  const previous = readState(statePath);
  const decision = shouldNotify(evaluation, previous, now());

  // State is persisted BEFORE the Slack post. A webhook 429/500 used to unwind
  // main() with the transition unrecorded, so the cache kept the stale verdict
  // and the next run alarmed again — every 30 minutes for the whole outage.
  writeState(statePath, decision.state);

  let deliveryError: unknown = null;
  if (decision.kind) {
    try {
      await postSlack(
        webhookUrl,
        renderMessage({
          evaluation,
          kind: decision.kind,
          now: now(),
          previous,
        }),
        fetchImpl,
      );
    } catch (error: unknown) {
      deliveryError = error;
    }
  }

  console.log(
    JSON.stringify({
      event: "production_probe",
      failed: evaluation.failed.map((result) => result.id),
      notified: decision.kind,
      verdict: evaluation.verdict,
    }),
  );

  // The transition is recorded either way, but a lost alarm must never be
  // silent: fail the job so the Actions log shows it.
  if (deliveryError) {
    console.error(
      JSON.stringify({
        event: "production_probe_slack_failed",
        message:
          deliveryError instanceof Error
            ? deliveryError.message
            : "unknown Slack failure",
        notified: decision.kind,
      }),
    );
    throw deliveryError;
  }

  return decision;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(
      JSON.stringify({
        error: error instanceof Error ? error.name : "UnknownError",
        event: "production_probe_failed",
      }),
    );
    process.exitCode = 1;
  });
}
