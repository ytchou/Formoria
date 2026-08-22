import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

import { boundedSlackText } from "@/lib/adapters/slack/notification";

export type ProbeVerdict = "down" | "gated" | "ok";

export type NotificationKind = "down" | "heartbeat" | "recovered";

export interface CheckResult {
  /** Raw response body, used only to recognise the maintenance gate. */
  body: string;
  id: string;
  ok: boolean;
  /** null when the request never produced a response. */
  status: number | null;
}

export interface ProbeEvaluation {
  checkCount: number;
  failed: readonly CheckResult[];
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
  return { checkCount: results.length, failed, verdict };
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

  // A missing previous state means the first run ever, or a lost cache. Record
  // the verdict but never alarm on it — there is no transition to report.
  if (previous === null) return { kind: null, state: base };

  if (changed && verdict === "down") return { kind: "down", state: base };
  if (changed && previous.verdict === "down")
    return { kind: "recovered", state: base };

  const heartbeatDue =
    verdict !== "down" &&
    now.getUTCHours() >= HEARTBEAT_HOUR_UTC &&
    lastHeartbeatDate !== utcDate(now);
  if (heartbeatDue) {
    return {
      kind: "heartbeat",
      state: { ...base, lastHeartbeatDate: utcDate(now) },
    };
  }

  return { kind: null, state: base };
}

function statusLabel(result: CheckResult): string {
  return result.status === null ? "no response" : String(result.status);
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
    const lines = evaluation.failed.map(
      (result) => `• ${result.id} — ${statusLabel(result)}`,
    );
    return boundedSlackText(
      [
        `🔴 Production probe failed (${evaluation.failed.length}/${evaluation.checkCount} checks) at ${stamp}`,
        ...lines,
      ].join("\n"),
    );
  }

  if (kind === "recovered") {
    const outage = previous ? durationLabel(previous.since, now) : "unknown";
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

export type ProbeEnvironment = Readonly<Record<string, string | undefined>>;

function requiredEnvironment(
  environment: ProbeEnvironment,
  name: string,
): string {
  const value = environment[name]?.trim();
  if (value) return value;
  const error = new Error(`${name} is required`);
  error.name = `MissingEnvironment:${name}`;
  throw error;
}

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
    return {
      lastHeartbeatDate:
        typeof candidate.lastHeartbeatDate === "string"
          ? candidate.lastHeartbeatDate
          : null,
      since:
        typeof candidate.since === "string"
          ? candidate.since
          : new Date(0).toISOString(),
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
    const body = await response.text().catch(() => "");
    return { body, id, ok: response.ok, status: response.status };
  } catch {
    return { body: "", id, ok: false, status: null };
  }
}

function healthIsDegraded(body: string): boolean {
  try {
    const parsed: unknown = JSON.parse(body);
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      (parsed as { rateLimitStore?: unknown }).rateLimitStore === "degraded"
    );
  } catch {
    return true;
  }
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

  const home = await request("home", `${base}/`, {}, fetchImpl);
  // Never probe /brands/<slug>: that prefix sits behind the Turnstile
  // soft-limit in proxy.ts, so a slug path would measure the challenge, not
  // the site.
  const brands = await request("brands", `${base}/brands`, {}, fetchImpl);
  const healthResponse = await request(
    "health",
    `${base}/api/health`,
    {},
    fetchImpl,
  );
  const health: CheckResult =
    healthResponse.ok && healthIsDegraded(healthResponse.body)
      ? { ...healthResponse, ok: false }
      : healthResponse;
  const supabaseCheck = await request(
    "supabase",
    `${supabase}/rest/v1/brands?select=id&limit=1`,
    {
      Authorization: `Bearer ${config.supabaseAnonKey}`,
      apikey: config.supabaseAnonKey,
    },
    fetchImpl,
  );

  return [home, brands, health, supabaseCheck];
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
    throw new Error(`Slack webhook returned HTTP ${response.status}`);
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

  if (decision.kind) {
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
  }

  writeState(statePath, decision.state);
  console.log(
    JSON.stringify({
      event: "production_probe",
      failed: evaluation.failed.map((result) => result.id),
      notified: decision.kind,
      verdict: evaluation.verdict,
    }),
  );
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
