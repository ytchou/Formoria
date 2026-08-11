import { createServiceClient } from "@/lib/supabase/service";
import { checkMitRegistryHealth } from "@/lib/services/mit-registry";
import {
  SERVICE_REGISTRY,
  toInventoryProjection,
  type InventoryEntry,
} from "@/lib/services/service-registry";

type ExecutiveHealthStatus = "healthy" | "degraded" | "down" | "unconfigured";
type ExecutiveHealthTier =
  "customer-critical" | "customer-flow" | "back-office";
export type ExecutiveOverallHealth = "healthy" | "warning" | "critical";

export interface ExecutiveServiceHealth {
  id: string;
  service: string;
  tier: ExecutiveHealthTier;
  status: ExecutiveHealthStatus;
  message: string;
  checkedAt: string;
}

export interface ExecutiveHealthSnapshot {
  status: ExecutiveOverallHealth;
  checkedAt: string;
  services: ExecutiveServiceHealth[];
  inventory: InventoryEntry[];
}

interface CheckResult {
  status: ExecutiveHealthStatus;
  message: string;
}

export interface ExecutiveHealthCheckDefinition {
  id: string;
  service: string;
  tier: ExecutiveHealthTier;
  request: Record<string, unknown>;
  run(): Promise<CheckResult>;
}

interface ExecutiveHealthAuditEvent {
  service: string;
  request: Record<string, unknown>;
  response: { status: ExecutiveHealthStatus; message: string };
  latencyMs: number;
  status: "success" | "error";
}

type Audit = (event: ExecutiveHealthAuditEvent) => void;

const CACHE_TTL_MS = 5 * 60_000;

function defaultAudit(event: ExecutiveHealthAuditEvent): void {
  console.info("[executive-health:audit]", event);
}

export async function runExecutiveHealthCheck(
  definition: ExecutiveHealthCheckDefinition,
  audit: Audit = defaultAudit,
): Promise<ExecutiveServiceHealth> {
  const startedAt = performance.now();
  let checkResult: CheckResult;

  try {
    checkResult = await definition.run();
  } catch {
    checkResult = { status: "down", message: "Provider request failed" };
  }

  const result: ExecutiveServiceHealth = {
    id: definition.id,
    service: definition.service,
    tier: definition.tier,
    ...checkResult,
    checkedAt: new Date().toISOString(),
  };
  audit({
    service: definition.service,
    request: definition.request,
    response: { status: result.status, message: result.message },
    latencyMs: Math.round(performance.now() - startedAt),
    status: result.status === "down" ? "error" : "success",
  });
  return result;
}

export function classifyExecutiveHealth(
  services: ExecutiveServiceHealth[],
): ExecutiveOverallHealth {
  if (
    services.some(
      (service) =>
        service.tier === "customer-critical" && service.status === "down",
    )
  ) {
    return "critical";
  }
  if (
    services.some(
      (service) =>
        (service.tier === "customer-critical" ||
          service.tier === "customer-flow") &&
        service.status !== "healthy",
    )
  )
    return "warning";
  return "healthy";
}

export async function loadExecutiveHealth(): Promise<ExecutiveHealthSnapshot> {
  const services = await Promise.all(
    defaultChecks().map((check) => runExecutiveHealthCheck(check)),
  );
  const inventory = SERVICE_REGISTRY.map(toInventoryProjection).filter(
    (entry): entry is NonNullable<typeof entry> => entry !== null,
  );
  return {
    status: classifyExecutiveHealth(services),
    checkedAt: new Date().toISOString(),
    services,
    inventory,
  };
}

export function createExecutiveHealthMonitor({
  load = loadExecutiveHealth,
  now = Date.now,
}: {
  load?: () => Promise<ExecutiveHealthSnapshot>;
  now?: () => number;
} = {}) {
  let cache: { value: ExecutiveHealthSnapshot; expiresAt: number } | null =
    null;

  async function refresh(): Promise<ExecutiveHealthSnapshot> {
    const value = await load();
    cache = { value, expiresAt: now() + CACHE_TTL_MS };
    return value;
  }

  async function get(): Promise<ExecutiveHealthSnapshot> {
    if (cache && cache.expiresAt > now()) return cache.value;
    return refresh();
  }

  return { get, refresh };
}

const executiveHealthMonitor = createExecutiveHealthMonitor();

export function getExecutiveHealth(): Promise<ExecutiveHealthSnapshot> {
  return executiveHealthMonitor.get();
}

export function refreshExecutiveHealth(): Promise<ExecutiveHealthSnapshot> {
  return executiveHealthMonitor.refresh();
}

function configured(
  value: string | undefined,
  missingMessage: string,
  run: () => Promise<CheckResult>,
): () => Promise<CheckResult> {
  return value
    ? run
    : async () => ({ status: "unconfigured", message: missingMessage });
}

function responseResult(
  response: Response,
  healthyMessage = "API reachable",
): CheckResult {
  return response.ok
    ? { status: "healthy", message: healthyMessage }
    : { status: "down", message: `API returned ${response.status}` };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function turnstileHealthResult(response: Response): Promise<CheckResult> {
  if (!response.ok) {
    return { status: "down", message: `API returned ${response.status}` };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { status: "down", message: "Turnstile returned malformed JSON" };
  }

  const errorCodes = isRecord(payload) ? payload["error-codes"] : undefined;
  if (
    !isRecord(payload) ||
    payload.success !== false ||
    !Array.isArray(errorCodes) ||
    errorCodes.length !== 1 ||
    errorCodes.at(0) !== "missing-input-response"
  ) {
    return { status: "down", message: "Turnstile health probe was rejected" };
  }

  return { status: "healthy", message: "Turnstile Siteverify reachable" };
}

export function defaultChecks(): ExecutiveHealthCheckDefinition[] {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  const resendKey = process.env.RESEND_API_KEY;
  const turnstileKey = process.env.TURNSTILE_SECRET_KEY;
  const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
  const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  const serperKey = process.env.SERPER_API_KEY;
  const openAiKey = process.env.OPENAI_API_KEY;
  const sentryBaseUrl = process.env.SENTRY_BASE_URL?.replace(/\/+$/, "");
  const sentryOrganization = process.env.SENTRY_ORGANIZATION;
  const sentryToken =
    process.env.SENTRY_READ_TOKEN ?? process.env.SENTRY_AUTH_TOKEN;
  const posthogHost = (process.env.POSTHOG_API_HOST ?? "").replace(/\/+$/, "");
  const posthogProjectId = process.env.POSTHOG_PROJECT_ID;
  const posthogToken = process.env.POSTHOG_PERSONAL_API_KEY;
  const curationWorkerUrl = process.env.CURATION_WORKER_URL?.replace(
    /\/+$/,
    "",
  );
  const curationWorkerToken = process.env.CURATION_WORKER_CONTROL_TOKEN;

  return [
    {
      id: "public-site",
      service: "Public site",
      tier: "customer-critical",
      request: {
        endpoint: siteUrl ?? null,
        method: "HEAD",
        configured: Boolean(siteUrl),
      },
      run: configured(siteUrl, "Site URL is not configured", async () =>
        responseResult(
          await fetch(siteUrl!, {
            method: "HEAD",
            signal: AbortSignal.timeout(3_000),
          }),
          "Site reachable",
        ),
      ),
    },
    {
      id: "supabase",
      service: "Supabase",
      tier: "customer-critical",
      request: { table: "brands", operation: "select", limit: 1 },
      run: async () => {
        const { error } = await createServiceClient()
          .from("brands")
          .select("id")
          .limit(1);
        return error
          ? { status: "down", message: "Database query failed" }
          : { status: "healthy", message: "Database reachable" };
      },
    },
    {
      id: "resend",
      service: "Resend",
      tier: "customer-flow",
      request: {
        endpoint: "https://api.resend.com/domains",
        configured: Boolean(resendKey),
      },
      run: configured(resendKey, "Resend is not configured", async () =>
        responseResult(
          await fetch("https://api.resend.com/domains", {
            headers: { Authorization: `Bearer ${resendKey}` },
            signal: AbortSignal.timeout(3_000),
          }),
        ),
      ),
    },
    {
      id: "cloudflare-turnstile",
      service: "Turnstile",
      tier: "customer-flow",
      request: {
        endpoint: "https://challenges.cloudflare.com/turnstile/v0/siteverify",
        configured: Boolean(turnstileKey),
      },
      run: async () => {
        if (!turnstileKey) {
          return {
            status: "down",
            message: "Turnstile secret is not configured",
          };
        }

        const body = new FormData();
        body.set("secret", turnstileKey);
        body.set("response", "");
        return turnstileHealthResult(
          await fetch(
            "https://challenges.cloudflare.com/turnstile/v0/siteverify",
            {
              method: "POST",
              body,
              signal: AbortSignal.timeout(3_000),
            },
          ),
        );
      },
    },
    {
      id: "upstash-redis",
      service: "Upstash Redis",
      tier: "customer-flow",
      request: {
        endpoint: upstashUrl ? `${upstashUrl}/ping` : null,
        configured: Boolean(upstashUrl && upstashToken),
      },
      run: configured(
        upstashUrl && upstashToken ? upstashToken : undefined,
        "Upstash Redis is not configured",
        async () =>
          responseResult(
            await fetch(`${upstashUrl}/ping`, {
              headers: { Authorization: `Bearer ${upstashToken}` },
              signal: AbortSignal.timeout(3_000),
            }),
            "Redis reachable",
          ),
      ),
    },
    {
      id: "serper",
      service: "Serper",
      tier: "back-office",
      request: {
        endpoint: "https://google.serper.dev/account",
        configured: Boolean(serperKey),
      },
      run: configured(serperKey, "Serper is not configured", async () =>
        responseResult(
          await fetch("https://google.serper.dev/account", {
            headers: { "X-API-KEY": serperKey! },
            signal: AbortSignal.timeout(5_000),
          }),
        ),
      ),
    },
    // DeepSeek is deliberately absent since the gpt-5.6-luna migration: no
    // production path calls it, so its account balance signals nothing about
    // work we actually do — a lapsed balance on a dormant fallback provider
    // must not page anyone. See deepseek-client.ts for the revival path.
    {
      id: "openai",
      service: "OpenAI",
      tier: "back-office",
      request: {
        endpoint: "https://api.openai.com/v1/models",
        configured: Boolean(openAiKey),
      },
      run: configured(openAiKey, "OpenAI is not configured", async () =>
        responseResult(
          await fetch("https://api.openai.com/v1/models", {
            headers: { Authorization: `Bearer ${openAiKey}` },
            signal: AbortSignal.timeout(3_000),
          }),
        ),
      ),
    },
    {
      id: "sentry",
      service: "Sentry",
      tier: "back-office",
      request: {
        endpoint:
          sentryBaseUrl && sentryOrganization
            ? `${sentryBaseUrl}/api/0/organizations/${encodeURIComponent(sentryOrganization)}/`
            : null,
        configured: Boolean(sentryBaseUrl && sentryOrganization && sentryToken),
      },
      run: configured(
        sentryBaseUrl && sentryOrganization && sentryToken
          ? sentryToken
          : undefined,
        "Sentry health-read probe is not configured",
        async () =>
          responseResult(
            await fetch(
              `${sentryBaseUrl}/api/0/organizations/${encodeURIComponent(sentryOrganization!)}/`,
              {
                headers: { Authorization: `Bearer ${sentryToken}` },
                signal: AbortSignal.timeout(5_000),
              },
            ),
            "Sentry reachable",
          ),
      ),
    },
    {
      id: "posthog",
      service: "PostHog",
      tier: "back-office",
      request: {
        endpoint:
          posthogHost && posthogProjectId
            ? `${posthogHost}/api/projects/${posthogProjectId}/`
            : null,
        configured: Boolean(posthogHost && posthogProjectId && posthogToken),
      },
      run: configured(
        posthogHost && posthogProjectId && posthogToken
          ? posthogToken
          : undefined,
        "PostHog query probe is not configured",
        async () =>
          responseResult(
            await fetch(`${posthogHost}/api/projects/${posthogProjectId}/`, {
              headers: { Authorization: `Bearer ${posthogToken}` },
              signal: AbortSignal.timeout(5_000),
            }),
            "PostHog reachable",
          ),
      ),
    },
    {
      id: "mit-registry",
      service: "MIT registry",
      tier: "customer-flow",
      request: {
        table: "mit_registry",
        operation: "select",
        orderBy: "synced_at",
        limit: 1,
      },
      run: checkMitRegistryHealth,
    },
    {
      id: "railway-curation-worker",
      service: "Curation worker",
      tier: "back-office",
      request: {
        endpoint: curationWorkerUrl ? `${curationWorkerUrl}/health` : null,
        configured: Boolean(curationWorkerUrl && curationWorkerToken),
      },
      run: configured(
        curationWorkerUrl && curationWorkerToken
          ? curationWorkerToken
          : undefined,
        "Curation worker is not configured",
        async () =>
          responseResult(
            await fetch(`${curationWorkerUrl}/health`, {
              headers: { Authorization: `Bearer ${curationWorkerToken}` },
              signal: AbortSignal.timeout(5_000),
            }),
            "Curation worker reachable",
          ),
      ),
    },
  ];
}
