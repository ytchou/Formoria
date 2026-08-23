import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assessUsageRisk,
  buildOperationalAlertSummary,
  buildOperationalSnapshot,
  fetchRailwayUsage,
  fetchUpstashUsage,
  RAILWAY_SERVICE_IDS,
  loadOperationalSnapshot,
  parseSentryAcceptedCount,
  parseUpstashDatabase,
  parseUpstashStats,
  type MeteredUsage,
  type UsageMetricInput,
} from "./operational-usage";
import { SERVICE_REGISTRY } from "./service-registry";

const NOW = new Date("2026-08-10T12:00:00.000Z");

function healthyHealth() {
  return Promise.resolve({
    status: "healthy" as const,
    checkedAt: NOW.toISOString(),
    services: [],
    inventory: [],
  });
}

function row(
  snapshot: Awaited<ReturnType<typeof loadOperationalSnapshot>>,
  id: string,
) {
  return snapshot.services.find((service) => service.id === id)!;
}

function railwayMetric(
  value: number,
  limit: number,
  subject: string | null = null,
) {
  return {
    value,
    unit: "GB",
    limit,
    percentage: value / limit,
    window: {
      start: "2026-08-09T00:00:00.000Z",
      end: "2026-08-10T00:00:00.000Z",
    },
    subject,
    source: "Railway metrics API",
    completeness: "exact" as const,
    freshness: NOW.toISOString(),
    projection: null,
    risk: assessUsageRisk({
      value,
      limit,
      completeness: "exact",
      projection: null,
    }),
  };
}

// Upstash is included and healthy so `needsAttention` reflects the Railway
// meter alone -- an absent Upstash row escalates on its own.
function railwaySnapshot(meter: MeteredUsage) {
  return buildOperationalSnapshot({
    registry: [
      {
        id: "upstash-redis",
        name: "Upstash Redis",
        vendor: "Upstash",
        category: "database",
        criticality: "customer-critical",
        operationalSection: "production",
        operationalKind: "dependency",
        envVars: [],
        status: "active",
        plan: {
          kind: "usage",
          asOf: "2026-08-10",
          sourceUrl: "https://upstash.com/pricing",
        },
      },
      {
        id: "railway-formoria",
        name: "Railway project (app + curation worker)",
        vendor: "Railway",
        category: "hosting",
        criticality: "customer-critical",
        operationalSection: "production",
        operationalKind: "dependency",
        envVars: [],
        status: "active",
        plan: {
          kind: "usage",
          asOf: "2026-08-10",
          sourceUrl: "https://railway.com/pricing",
        },
      },
    ],
    health: {
      status: "healthy",
      checkedAt: NOW.toISOString(),
      inventory: [],
      services: [],
    },
    meters: new Map<string, MeteredUsage>([
      ["upstash-redis", { state: "ready" }],
      ["railway-formoria", meter],
    ]),
    now: NOW,
  });
}

// One daily egress sample inside yesterday's UTC window plus seven daily
// memory samples, the envelope Railway returns at sampleRateSeconds 86400.
// `memoryGb: null` drops the memory series entirely -- the shape a service
// that reported no memory samples returns.
function railwayResponse(
  egressGb = 1.2,
  memoryGb: number | null = 0.5,
): Response {
  const day = (offset: number) =>
    new Date(Date.UTC(2026, 7, 9 - offset)).toISOString();
  return Response.json({
    data: {
      metrics: [
        {
          measurement: "NETWORK_TX_GB",
          values: [{ ts: day(0), value: egressGb }],
        },
        ...(memoryGb === null
          ? []
          : [
              {
                measurement: "MEMORY_USAGE_GB",
                values: Array.from({ length: 7 }, (_unused, index) => ({
                  ts: day(index),
                  value: memoryGb,
                })),
              },
            ]),
      ],
    },
  });
}

// Distinct per-service responses, in RAILWAY_SERVICE_IDS order: memory is
// assessed per service, so a fixture that answers both services identically
// cannot tell a per-service assessment from a summed one.
function railwayPerServiceFetch(
  services: Array<{ egressGb?: number; memoryGb: number | null }>,
) {
  const mock = vi.fn<typeof fetch>();
  for (const service of services) {
    mock.mockResolvedValueOnce(
      railwayResponse(service.egressGb ?? 1.2, service.memoryGb),
    );
  }
  return mock;
}

function clearProviderEnvironment() {
  for (const name of [
    "OPENAI_API_KEY",
    "SERPER_API_KEY",
    "UPSTASH_API_EMAIL",
    "UPSTASH_API_KEY",
    "UPSTASH_REDIS_DATABASE_ID",
    "POSTHOG_API_HOST",
    "POSTHOG_PROJECT_ID",
    "POSTHOG_PERSONAL_API_KEY",
    "SENTRY_BASE_URL",
    "SENTRY_ORGANIZATION",
    "SENTRY_READ_TOKEN",
    "SENTRY_AUTH_TOKEN",
    "RAILWAY_API_TOKEN",
  ]) {
    vi.stubEnv(name, "");
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const metric = (
  overrides: Partial<UsageMetricInput> = {},
): UsageMetricInput => ({
  value: 50,
  limit: 100,
  completeness: "exact",
  projection: null,
  ...overrides,
});

describe("operational usage risk", () => {
  // Bug caught: a meter could render a healthy badge after crossing the configured budget.
  it("raises warning and critical thresholds from the observed ratio", () => {
    expect(assessUsageRisk(metric({ value: 70 }))).toBe("warning");
    expect(assessUsageRisk(metric({ value: 90 }))).toBe("critical");
  });

  // Bug caught: a current-window meter could silently miss a window-end overage when its observed ratio is still low.
  it("warns when the projected window-end consumption reaches the limit", () => {
    expect(assessUsageRisk(metric({ value: 40, projection: 1 }))).toBe(
      "warning",
    );
  });

  // Bug caught: lower-bound local measurements were presented as normal even though provider sends were not fully observed.
  it("never marks a lower-bound measurement normal", () => {
    expect(
      assessUsageRisk(metric({ value: 10, completeness: "lower_bound" })),
    ).toBe("unknown");
    expect(
      assessUsageRisk(metric({ value: 90, completeness: "lower_bound" })),
    ).toBe("critical");
  });

  it("keeps an unavailable denominator explicitly unknown", () => {
    expect(assessUsageRisk(metric({ value: 500, limit: null }))).toBe(
      "unknown",
    );
  });

  // Bug caught: Cloudflare's two health checks could be emitted as unrelated rows, making an origin failure invisible.
  it("aggregates Cloudflare children and keeps an unverified child unknown", () => {
    const registry = [
      {
        id: "cloudflare-turnstile",
        name: "Cloudflare Turnstile",
        vendor: "Cloudflare",
        category: "security",
        criticality: "customer-flow",
        operationalSection: "production",
        operationalKind: "dependency",
        envVars: [],
        status: "active",
        plan: {
          kind: "free",
          monthlyUsd: 0,
          asOf: "2026-08-10",
          sourceUrl: "https://cloudflare.com",
        },
      },
      {
        id: "cloudflare-origin",
        name: "Cloudflare origin protection",
        vendor: "Cloudflare",
        category: "security",
        criticality: "customer-critical",
        operationalSection: "production",
        operationalKind: "dependency",
        envVars: [],
        status: "active",
        plan: {
          kind: "free",
          monthlyUsd: 0,
          asOf: "2026-08-10",
          sourceUrl: "https://cloudflare.com",
        },
      },
    ] as const;
    const snapshot = buildOperationalSnapshot({
      registry,
      health: {
        status: "warning",
        checkedAt: "2026-08-10T00:00:00.000Z",
        inventory: [],
        services: [
          {
            id: "cloudflare-turnstile",
            service: "Turnstile",
            tier: "customer-flow",
            status: "healthy",
            message: "Passed",
            checkedAt: "2026-08-10T00:00:00.000Z",
          },
        ],
      },
    });
    expect(snapshot.services).toHaveLength(1);
    expect(snapshot.services[0]?.health.status).toBe("unknown");
    expect(snapshot.services[0]?.health.checks).toEqual([
      expect.objectContaining({ name: "Turnstile", status: "healthy" }),
      expect.objectContaining({ name: "Origin protection", status: "unknown" }),
    ]);
  });

  it("does not turn a missing Turnstile secret into a critical Cloudflare parent", () => {
    const snapshot = buildOperationalSnapshot({
      registry: [
        {
          id: "cloudflare-turnstile",
          name: "Cloudflare Turnstile",
          vendor: "Cloudflare",
          category: "security",
          criticality: "customer-flow",
          operationalSection: "production",
          operationalKind: "dependency",
          envVars: [],
          status: "active",
          plan: {
            kind: "free",
            asOf: "2026-08-10",
            sourceUrl: "https://cloudflare.com",
          },
        },
        {
          id: "cloudflare-origin",
          name: "Cloudflare origin protection",
          vendor: "Cloudflare",
          category: "security",
          criticality: "customer-critical",
          operationalSection: "production",
          operationalKind: "dependency",
          envVars: [],
          status: "active",
          plan: {
            kind: "free",
            asOf: "2026-08-10",
            sourceUrl: "https://cloudflare.com",
          },
        },
      ],
      health: {
        status: "warning",
        checkedAt: NOW.toISOString(),
        inventory: [],
        services: [
          {
            id: "cloudflare-turnstile",
            service: "Turnstile",
            tier: "customer-flow",
            status: "unconfigured",
            message: "Turnstile secret is not configured",
            checkedAt: NOW.toISOString(),
          },
          {
            id: "cloudflare-origin",
            service: "Cloudflare origin protection",
            tier: "customer-critical",
            status: "healthy",
            message: "Passed",
            checkedAt: NOW.toISOString(),
          },
        ],
      },
      now: NOW,
    });
    expect(snapshot.services[0]?.health.status).toBe("unknown");
    expect(snapshot.services[0]?.health.status).not.toBe("critical");
  });

  it("redacts the Upstash database id from captured audit metadata", async () => {
    const output: unknown[][] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => output.push(args));
    const databaseId = "database-id-audit-secret";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          db_request_limit: 100,
          db_disk_threshold: 10_000,
          type: "free",
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ total_monthly_requests: 20, daily_net_commands: 2 }),
      );
    await fetchUpstashUsage({
      email: "operator@example.com",
      apiKey: "secret-api-key",
      databaseId,
      fetchImpl: fetchMock,
      now: NOW,
    });
    const captured = JSON.stringify(output);
    expect(captured).not.toContain(databaseId);
    expect(captured).toContain("/v2/redis/database/:database-id");
    expect(captured).toContain("/v2/redis/stats/:database-id");
  });

  it("keeps warning and critical secondary metrics visible to Spend Watch", () => {
    const snapshot = buildOperationalSnapshot({
      registry: [
        {
          id: "upstash-redis",
          name: "Upstash Redis",
          vendor: "Upstash",
          category: "database",
          criticality: "customer-flow",
          operationalSection: "production",
          operationalKind: "dependency",
          envVars: [],
          status: "active",
          plan: {
            kind: "usage",
            asOf: "2026-08-10",
            sourceUrl: "https://upstash.com",
          },
        },
      ],
      health: {
        status: "healthy",
        checkedAt: NOW.toISOString(),
        inventory: [],
        services: [],
      },
      meters: new Map([
        [
          "upstash-redis",
          {
            state: "ready",
            primary: {
              value: 10,
              unit: "commands",
              limit: 100,
              percentage: 0.1,
              window: {
                start: "2026-08-01T00:00:00.000Z",
                end: "2026-09-01T00:00:00.000Z",
              },
              subject: null,
              source: "test",
              completeness: "exact",
              freshness: NOW.toISOString(),
              projection: null,
              risk: "normal",
            },
            secondary: {
              value: 95,
              unit: "commands today",
              limit: 100,
              percentage: 0.95,
              window: {
                start: "2026-08-10T00:00:00.000Z",
                end: "2026-08-11T00:00:00.000Z",
              },
              subject: null,
              source: "test",
              completeness: "exact",
              freshness: NOW.toISOString(),
              projection: null,
              risk: "critical",
            },
            additional: [
              {
                value: 8,
                unit: "bytes",
                limit: 10,
                percentage: 0.8,
                window: {
                  start: "2026-08-01T00:00:00.000Z",
                  end: "2026-09-01T00:00:00.000Z",
                },
                subject: null,
                source: "test",
                completeness: "exact",
                freshness: NOW.toISOString(),
                projection: null,
                risk: "warning",
              },
            ],
          },
        ],
      ]),
      now: NOW,
    });
    const alerts = buildOperationalAlertSummary(snapshot);
    expect(alerts.needsAttention).toBe(true);
    expect(alerts.warnings).toEqual(
      expect.arrayContaining([
        // Non-primary warnings carry their reading; "secondary usage is
        // critical." alone names neither the quantity nor the amount.
        "Upstash Redis secondary usage is critical. 95 of 100 commands today.",
        "Upstash Redis additional usage is warning. 8 of 10 bytes.",
      ]),
    );
  });

  // Bug caught: Upstash limits were taken from a stale registry constant and credentials could leak into request logs.
  it("uses authenticated Upstash runtime limits and marks command headroom", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          db_request_limit: 100,
          db_disk_threshold: 10_000,
          type: "free",
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          total_monthly_requests: 90,
          daily_net_commands: 5,
          current_storage: 2_000,
          total_monthly_bandwidth: 4_000,
          updated_at: "2026-08-10T12:00:00.000Z",
          command_counts: [{ data_points: [{ y: 90 }] }],
        }),
      );
    await expect(
      fetchUpstashUsage({
        email: "operator@example.com",
        apiKey: "secret-api-key",
        databaseId: "db-123",
        fetchImpl: fetchMock,
        now: new Date("2026-08-10T12:00:00.000Z"),
      }),
    ).resolves.toMatchObject({
      state: "ready",
      primary: expect.objectContaining({
        value: 90,
        limit: 100,
        risk: "critical",
      }),
      secondary: expect.objectContaining({ value: 5 }),
      additional: [expect.objectContaining({ value: 2_000, limit: 10_000 })],
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("/v2/redis/database/db-123"),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Basic ${Buffer.from("operator@example.com:secret-api-key").toString("base64")}`,
        }),
      }),
    );
    // Bug caught: a daily report could consume the Management API quota twice inside the five-minute snapshot window.
    await fetchUpstashUsage({
      email: "operator@example.com",
      apiKey: "secret-api-key",
      databaseId: "db-123",
      fetchImpl: fetchMock,
      now: new Date("2026-08-10T12:00:00.000Z"),
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain(
      "secret-api-key",
    );
  });

  it("parses provider metric envelopes without inventing an unverified denominator", () => {
    expect(
      parseUpstashDatabase({
        db_request_limit: "100",
        db_disk_threshold: "1000",
        type: "free",
      }),
    ).toEqual({ requestLimit: 100, storageLimit: 1000, plan: "free" });
    expect(
      parseUpstashStats({
        total_monthly_requests: "5",
        daily_net_commands: "4",
        current_storage: "12",
        throughput: [{ y: 9 }],
        command_counts: [{ data_points: [{ y: 2 }, { y: 3 }] }],
      }),
    ).toMatchObject({
      monthlyCommands: 5,
      todayCommands: 4,
      storage: 12,
      bandwidth: null,
    });
    expect(
      parseSentryAcceptedCount({
        groups: [
          { totals: { "sum(quantity)": 4 } },
          { totals: { "sum(quantity)": "6" } },
        ],
      }),
    ).toBe(10);
  });

  it.each([
    {},
    { total_monthly_requests: "not-a-number", daily_net_commands: 1 },
    { total_monthly_requests: 1 },
    { total_monthly_requests: 1, daily_net_commands: null },
  ])("rejects incomplete Upstash usage fields: %#", (value) => {
    expect(() => parseUpstashStats(value)).toThrow(
      "Upstash stats response is missing a valid monthly or daily command total.",
    );
  });

  it("rejects Sentry stats without a valid accepted error total", () => {
    expect(() => parseSentryAcceptedCount({ groups: [] })).toThrow(
      "Sentry stats response did not contain an accepted error total.",
    );
    expect(() =>
      parseSentryAcceptedCount({
        groups: [{ totals: { "sum(quantity)": "invalid" } }],
      }),
    ).toThrow("Sentry stats response did not contain an accepted error total.");
  });

  it("leaves point-in-time storage unprojected and omits unbounded bandwidth", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          db_request_limit: 100,
          db_disk_threshold: 10_000,
          type: "free",
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          total_monthly_requests: 20,
          daily_net_commands: 2,
          current_storage: 2_000,
          total_monthly_bandwidth: 4_000,
        }),
      );
    const usage = await fetchUpstashUsage({
      email: "operator@example.com",
      apiKey: "secret-api-key",
      databaseId: "db-storage-boundary",
      fetchImpl: fetchMock,
      now: NOW,
    });
    expect(usage.additional).toEqual([
      expect.objectContaining({ unit: "bytes", projection: null }),
    ]);
  });

  // Bug caught: a successful limits call could leave stale-looking usage visible after the stats call failed.
  it("fails the Upstash meter when either parallel provider request fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ db_request_limit: 100 }))
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }));

    await expect(
      fetchUpstashUsage({
        email: "operator@example.com",
        apiKey: "secret-api-key",
        databaseId: "db-partial-failure",
        fetchImpl: fetchMock,
      }),
    ).rejects.toThrow("Upstash returned HTTP 503");
  });

  // Bug caught: Railway egress was dashboard-only, so a traffic flood reached the
  // invoice before it reached the daily report.
  it("marks Railway egress ready from the metrics envelope", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(railwayResponse()));
    const usage = await fetchRailwayUsage({
      apiToken: "railway-token",
      projectId: "project-ready",
      environmentId: "environment-ready",
      fetchImpl: fetchMock,
      now: NOW,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(usage.state).toBe("ready");
    // Both Railway services are summed into one egress meter.
    expect(usage.primary?.value).toBeCloseTo(2.4, 10);
    expect(usage.primary).toMatchObject({
      unit: "GB",
      limit: 5,
      completeness: "exact",
      projection: null,
      risk: "normal",
      window: {
        start: "2026-08-09T00:00:00.000Z",
        end: "2026-08-10T00:00:00.000Z",
      },
    });
    // Memory is NOT summed: 1.5 GB is a per-service limit, so the published
    // figure is one service's 7-day mean, not both added together.
    expect(usage.secondary?.value).toBeCloseTo(0.5, 10);
    expect(usage.secondary).toMatchObject({
      unit: "GB",
      limit: 1.5,
      risk: "normal",
      subject: expect.stringContaining(RAILWAY_SERVICE_IDS[0]),
      window: {
        start: "2026-08-03T00:00:00.000Z",
        end: "2026-08-10T00:00:00.000Z",
      },
    });
  });

  // Bug caught (critical): the memory means of both services were summed and
  // compared against the per-service 1.5 GB limit, so two healthy services at
  // 0.9 and 0.8 GB produced ratio 1.13 and paged critical every single day.
  // An alarm that fires daily on healthy services is a disabled alarm.
  it("keeps two healthy Railway services normal instead of summing them past the limit", async () => {
    const fetchMock = railwayPerServiceFetch([
      { memoryGb: 0.9 },
      { memoryGb: 0.8 },
    ]);
    const usage = await fetchRailwayUsage({
      apiToken: "railway-token",
      projectId: "project-memory-healthy",
      environmentId: "environment-memory-healthy",
      fetchImpl: fetchMock,
      now: NOW,
    });

    expect(usage.state).toBe("ready");
    // The worst service, not the sum.
    expect(usage.secondary?.value).toBeCloseTo(0.9, 10);
    expect(usage.secondary?.risk).toBe("normal");
    // Egress stays summed -- both services bill against one project allowance.
    expect(usage.primary?.value).toBeCloseTo(2.4, 10);
  });

  it("warns on the single Railway service over the per-service memory limit and names it", async () => {
    const fetchMock = railwayPerServiceFetch([
      { memoryGb: 0.2 },
      { memoryGb: 1.2 },
    ]);
    const usage = await fetchRailwayUsage({
      apiToken: "railway-token",
      projectId: "project-memory-warning",
      environmentId: "environment-memory-warning",
      fetchImpl: fetchMock,
      now: NOW,
    });

    expect(usage.secondary?.value).toBeCloseTo(1.2, 10);
    expect(usage.secondary?.risk).toBe("warning");
    // Without the service id the operator knows the project is over but not
    // which service to restart.
    expect(usage.secondary?.subject).toContain(RAILWAY_SERVICE_IDS[1]);
    expect(usage.secondary?.source).toContain("2/2");
  });

  // A service with no memory samples is unknown, never a healthy 0 that could
  // drag a mean down. The service that DID report is still assessed, and the
  // partial coverage is recorded on the metric.
  it("assesses the reporting Railway service when the other returns no memory samples", async () => {
    const fetchMock = railwayPerServiceFetch([
      { memoryGb: null },
      { memoryGb: 1.4 },
    ]);
    const usage = await fetchRailwayUsage({
      apiToken: "railway-token",
      projectId: "project-memory-partial",
      environmentId: "environment-memory-partial",
      fetchImpl: fetchMock,
      now: NOW,
    });

    expect(usage.secondary?.value).toBeCloseTo(1.4, 10);
    expect(usage.secondary?.risk).toBe("critical");
    expect(usage.secondary?.subject).toContain(RAILWAY_SERVICE_IDS[1]);
    expect(usage.secondary?.source).toContain("1/2");
  });

  // Bug caught: a mean over zero samples is unknown, not 0.00 GB at normal.
  it("omits the Railway memory metric when no service reported samples", async () => {
    const fetchMock = railwayPerServiceFetch([
      { memoryGb: null },
      { memoryGb: null },
    ]);
    const usage = await fetchRailwayUsage({
      apiToken: "railway-token",
      projectId: "project-memory-absent",
      environmentId: "environment-memory-absent",
      fetchImpl: fetchMock,
      now: NOW,
    });

    expect(usage.state).toBe("ready");
    expect(usage.secondary ?? null).toBeNull();
  });

  // Bug caught: the meter used to read the project and environment ids from
  // the environment, so a fresh `cp .env.example .env.local` produced a
  // "partial" configuration that mapped to `error` and hard-failed
  // `make doctor`. The ids are pinned in source now, and the combination that
  // actually occurs -- ids present (Railway injects them into every deployed
  // service), token absent -- must read `unconfigured`.
  it("reports a missing Railway token as unconfigured even with the platform-injected ids present", async () => {
    clearProviderEnvironment();
    vi.stubEnv("RAILWAY_PROJECT_ID", "injected-by-the-platform");
    vi.stubEnv("RAILWAY_ENVIRONMENT_ID", "injected-by-the-platform");
    const absent = await loadOperationalSnapshot({
      now: NOW,
      health: healthyHealth(),
      supabase: null,
      posthog: null,
    });
    expect(row(absent, "railway-formoria").usage).toMatchObject({
      state: "unconfigured",
      message: expect.stringContaining("RAILWAY_API_TOKEN"),
    });
  });

  // Shortcut guard: RAILWAY_SERVICE_IDS is pinned by hand, so a Railway
  // service added to the registry without its id here would silently drop out
  // of the summed egress while the meter still published `exact`.
  it("meters every Railway service in the registry", () => {
    const railwayServices = SERVICE_REGISTRY.filter(
      (entry) => entry.vendor === "Railway",
    );
    expect(RAILWAY_SERVICE_IDS).toHaveLength(railwayServices.length);
    expect(new Set(RAILWAY_SERVICE_IDS).size).toBe(RAILWAY_SERVICE_IDS.length);
  });

  // Bug caught: Railway answers an unauthorized query with HTTP 200 and an
  // `errors` array, which would otherwise render as zero egress.
  it("fails the Railway meter on a GraphQL error body", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(
          Response.json({ errors: [{ message: "Not Authorized" }] }),
        ),
      );
    const usage = await fetchRailwayUsage({
      apiToken: "railway-token",
      projectId: "project-graphql-error",
      environmentId: "environment-graphql-error",
      fetchImpl: fetchMock,
      now: NOW,
    });
    expect(usage.state).toBe("error");
    // The provider text never reaches the snapshot, the cron JSON, or Slack --
    // the same contract every sibling meter follows.
    expect(usage.message).toBe("Railway metrics request failed.");
    expect(usage.message).not.toContain("Not Authorized");
    expect(usage.primary ?? null).toBeNull();
  });

  // Bug caught: Railway answers a GraphQL failure with HTTP 200, so the audit
  // span recorded a succeeded call at the same moment every report said the
  // meter was unavailable.
  it("records a Railway GraphQL error body as a failed audit span", async () => {
    const output: unknown[][] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => output.push(args));
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(
          Response.json({ errors: [{ message: "Not Authorized" }] }),
        ),
      );
    await fetchRailwayUsage({
      apiToken: "railway-token",
      projectId: "project-graphql-audit",
      environmentId: "environment-graphql-audit",
      fetchImpl: fetchMock,
      now: NOW,
    });
    const captured = JSON.stringify(output);
    expect(captured).toContain("failed");
    expect(captured).not.toContain("succeeded");
  });

  // Bug caught (critical): an empty series, a renamed measurement, or an
  // expired metrics scope all produced `0.00 GB` at `exact` and `normal` --
  // a false green on the alarm that exists to catch a traffic flood.
  it("refuses to publish a zero-sample Railway egress reading as normal", async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        Response.json({
          data: {
            metrics: [
              // The measurement Railway used to return, renamed.
              { measurement: "NETWORK_TX", values: [{ ts: NOW.toISOString(), value: 4 }] },
              { measurement: "MEMORY_USAGE_GB", values: [] },
            ],
          },
        }),
      ),
    );
    const usage = await fetchRailwayUsage({
      apiToken: "railway-token",
      projectId: "project-no-samples",
      environmentId: "environment-no-samples",
      fetchImpl: fetchMock,
      now: NOW,
    });
    expect(usage.state).toBe("error");
    expect(usage.message).toContain("no egress samples");
    expect(usage.primary ?? null).toBeNull();
  });

  // Bug caught: `Number(null)`, `Number("")`, and `Number(false)` are all a
  // finite 0, so a gap in the series was recorded as a real zero reading.
  it("drops non-numeric Railway samples instead of reading them as zero", async () => {
    const day = new Date(Date.UTC(2026, 7, 9)).toISOString();
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        Response.json({
          data: {
            metrics: [
              {
                measurement: "NETWORK_TX_GB",
                values: [
                  { ts: day, value: null },
                  { ts: day, value: "" },
                  { ts: day, value: false },
                ],
              },
            ],
          },
        }),
      ),
    );
    const usage = await fetchRailwayUsage({
      apiToken: "railway-token",
      projectId: "project-null-samples",
      environmentId: "environment-null-samples",
      fetchImpl: fetchMock,
      now: NOW,
    });
    expect(usage.state).toBe("error");
    expect(usage.message).toContain("no egress samples");
  });

  it("redacts the Railway token from captured audit metadata", async () => {
    const output: unknown[][] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => output.push(args));
    const apiToken = "railway-token-audit-secret";
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(railwayResponse()));
    await fetchRailwayUsage({
      apiToken,
      projectId: "project-audit",
      environmentId: "environment-audit",
      fetchImpl: fetchMock,
      now: NOW,
    });
    const captured = JSON.stringify(output);
    expect(captured).not.toContain(apiToken);
    expect(captured).toContain("https://backboard.railway.com/graphql/v2");
    // The wire request must carry `Authorization: Bearer <token>`, so the fetch
    // mock's recorded args always hold the token. The subject here is the audit
    // record: it may never grow a header-bearing key.
    const lowered = captured.toLowerCase();
    expect(lowered).not.toContain("authorization");
    expect(lowered).not.toContain("headers");
  });

  it("includes railway in the alert summary", () => {
    const snapshot = buildOperationalSnapshot({
      registry: [
        {
          id: "railway-formoria",
          name: "Railway project (app + curation worker)",
          vendor: "Railway",
          category: "hosting",
          criticality: "customer-critical",
          operationalSection: "production",
          operationalKind: "dependency",
          envVars: [],
          status: "active",
          plan: {
            kind: "usage",
            asOf: "2026-08-10",
            sourceUrl: "https://railway.com/pricing",
          },
        },
      ],
      health: {
        status: "healthy",
        checkedAt: NOW.toISOString(),
        inventory: [],
        services: [],
      },
      meters: new Map([
        [
          "railway-formoria",
          {
            state: "ready" as const,
            primary: {
              value: 3.6,
              unit: "GB",
              limit: 5,
              percentage: 0.72,
              window: {
                start: "2026-08-09T00:00:00.000Z",
                end: "2026-08-10T00:00:00.000Z",
              },
              subject: null,
              source: "Railway metrics API",
              completeness: "exact" as const,
              freshness: NOW.toISOString(),
              projection: null,
              risk: "warning" as const,
            },
          },
        ],
      ]),
      now: NOW,
    });
    const alerts = buildOperationalAlertSummary(snapshot);
    expect(alerts.railway).toMatchObject({
      state: "ready",
      risk: "warning",
      value: 3.6,
      limit: 5,
    });
    expect(alerts.warnings).toEqual(
      expect.arrayContaining([
        "Railway project (app + curation worker) usage is warning.",
      ]),
    );
  });

  // Bug caught (critical): a rotated or expired RAILWAY_API_TOKEN put the
  // meter in `error` with no warnings, so `needsAttention` stayed false and
  // the egress alarm could be dead indefinitely inside an otherwise-normal
  // digest.
  it("escalates an unavailable Railway meter but not an unconfigured one", () => {
    const errored = buildOperationalAlertSummary(
      railwaySnapshot({ state: "error", message: "Railway metrics request failed." }),
    );
    expect(errored.unavailableRailway).toBe(true);
    expect(errored.needsAttention).toBe(true);

    // The token is set by hand after this ships, so absence must not page
    // daily until then.
    const unconfigured = buildOperationalAlertSummary(
      railwaySnapshot({ state: "unconfigured", message: "Railway usage requires RAILWAY_API_TOKEN." }),
    );
    expect(unconfigured.unavailableRailway).toBe(false);
    expect(unconfigured.needsAttention).toBe(false);
  });

  // Bug caught: the memory metric rides `usage.secondary`, which the alert
  // meter dropped -- a memory warning reached Slack as "secondary usage is
  // warning." with no value, unit, limit, or attribution.
  it("carries the Railway memory metric, its reading, and the service it belongs to into the alert summary", () => {
    const alerts = buildOperationalAlertSummary(
      railwaySnapshot({
        state: "ready",
        primary: railwayMetric(1, 5),
        secondary: railwayMetric(1.4, 1.5, "service service-b"),
      }),
    );
    expect(alerts.railwayMemory).toMatchObject({
      state: "ready",
      value: 1.4,
      limit: 1.5,
      risk: "critical",
      subject: "service service-b",
    });
    // The row name covers both services; without the subject the operator
    // knows the project is over memory but not which service to act on.
    expect(alerts.warnings).toEqual(
      expect.arrayContaining([
        "Railway project (app + curation worker) secondary usage is critical. service service-b: 1.4 of 1.5 GB.",
      ]),
    );
  });

  it("reports partial Upstash configuration as an error while absence stays unconfigured", async () => {
    clearProviderEnvironment();
    vi.stubEnv("UPSTASH_API_EMAIL", "operator@example.com");
    const partial = await loadOperationalSnapshot({
      now: NOW,
      health: healthyHealth(),
      supabase: null,
      posthog: null,
    });
    expect(row(partial, "upstash-redis").usage).toMatchObject({
      state: "error",
    });

    vi.stubEnv("UPSTASH_API_EMAIL", "");
    const absent = await loadOperationalSnapshot({
      now: NOW,
      health: healthyHealth(),
      supabase: null,
      posthog: null,
    });
    expect(row(absent, "upstash-redis").usage).toMatchObject({
      state: "unconfigured",
    });
  });

  it("keeps all-provider failures independent and preserves completeness states", async () => {
    clearProviderEnvironment();
    vi.stubEnv("OPENAI_API_KEY", "openai-key");
    vi.stubEnv("SERPER_API_KEY", "serper-key");
    vi.stubEnv("POSTHOG_API_HOST", "https://us.posthog.com");
    vi.stubEnv("POSTHOG_PROJECT_ID", "123");
    vi.stubEnv("POSTHOG_PERSONAL_API_KEY", "posthog-key");
    vi.stubEnv("SENTRY_BASE_URL", "https://sentry.example");
    vi.stubEnv("SENTRY_ORGANIZATION", "formoria");
    vi.stubEnv("SENTRY_READ_TOKEN", "sentry-key");
    const query = (result: {
      count: number | null;
      error: { message: string } | null;
    }) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        gte: () => chain,
        lt: () => Promise.resolve(result),
      };
      return chain;
    };
    // Serper and Resend both read `external_call_audit_spans`, so the failure
    // has to be scoped to the provider the query filters on -- otherwise the
    // Resend row fails for a reason this test is not about. `loadAuditUsage`
    // calls `.eq("provider", provider)`, so capture that argument.
    const auditQuery = () => {
      let provider: string | null = null;
      const chain = {
        select: () => chain,
        eq: (column: string, value: string) => {
          if (column === "provider") provider = value;
          return chain;
        },
        gte: () => chain,
        lt: () =>
          Promise.resolve(
            provider === "serper"
              ? {
                  count: null,
                  error: { message: "Serper audit query failed" },
                }
              : { count: 4, error: null },
          ),
      };
      return chain;
    };
    const supabase = {
      from: (table: string) =>
        table === "external_call_audit_spans"
          ? auditQuery()
          : query({ count: 4, error: null }),
    } as never;
    const posthog = {
      run: vi.fn().mockResolvedValue({ columns: ["events"], results: [[12]] }),
    };
    const snapshot = await loadOperationalSnapshot({
      now: NOW,
      health: healthyHealth(),
      supabase,
      posthog,
      spend: Promise.reject(new Error("OpenAI spend query failed")),
      fetchImpl: vi.fn().mockResolvedValue(Response.json({ groups: [] })),
    });
    expect(row(snapshot, "openai").usage).toMatchObject({
      state: "error",
      primary: null,
    });
    expect(row(snapshot, "serper").usage).toMatchObject({
      state: "error",
      primary: null,
    });
    expect(row(snapshot, "resend").usage).toMatchObject({
      state: "ready",
      primary: expect.objectContaining({
        completeness: "exact",
        limit: 3_000,
      }),
    });
    expect(row(snapshot, "posthog").usage).toMatchObject({
      state: "ready",
      primary: expect.objectContaining({
        completeness: "exact",
        limit: 1_000_000,
      }),
    });
    expect(row(snapshot, "sentry").usage).toMatchObject({
      state: "error",
      primary: null,
    });
  });

  it("marks measured OpenAI, Serper, and Resend usage exact", async () => {
    clearProviderEnvironment();
    vi.stubEnv("OPENAI_API_KEY", "openai-key");
    vi.stubEnv("SERPER_API_KEY", "serper-key");
    const query = () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        gte: () => chain,
        lt: () => Promise.resolve({ count: 3, error: null }),
      };
      return chain;
    };
    const snapshot = await loadOperationalSnapshot({
      now: NOW,
      health: healthyHealth(),
      supabase: { from: () => query() } as never,
      posthog: null,
      spend: Promise.resolve({
        schemaVersion: 1,
        generatedAt: NOW.toISOString(),
        cycles: [
          {
            resetsOnDay: 1,
            start: "2026-08-01T00:00:00.000Z",
            end: "2026-09-01T00:00:00.000Z",
          },
        ],
        services: [
          {
            id: "openai",
            provenance: "derived",
            amountUsd: 2,
            units: 10,
            unitLabel: "tokens",
            quotaUsedRatio: null,
            asOf: null,
            pricingCoverage: 1,
          },
        ],
        totals: { declaredMonthlyUsd: 0, derivedCycleUsd: 2 },
        coverage: {
          unmeteredServices: 0,
          unpricedCalls: 0,
          inFlightCalls: 0,
          nonLlmDollarsAvailable: false,
        },
      }),
    });
    expect(row(snapshot, "openai").usage).toMatchObject({
      state: "ready",
      primary: expect.objectContaining({ completeness: "exact", limit: 25 }),
      secondary: expect.objectContaining({ unit: "tokens" }),
    });
    expect(row(snapshot, "serper").usage).toMatchObject({
      state: "ready",
      primary: expect.objectContaining({ completeness: "exact", limit: null }),
    });
    expect(row(snapshot, "resend").usage).toMatchObject({
      state: "ready",
      primary: expect.objectContaining({
        completeness: "exact",
        limit: 3_000,
      }),
    });
  });

  it("keeps a valid Sentry count exact but without an unverified limit", async () => {
    clearProviderEnvironment();
    vi.stubEnv("SENTRY_BASE_URL", "https://sentry.example");
    vi.stubEnv("SENTRY_ORGANIZATION", "formoria");
    vi.stubEnv("SENTRY_READ_TOKEN", "sentry-key");
    const snapshot = await loadOperationalSnapshot({
      now: NOW,
      health: healthyHealth(),
      supabase: null,
      posthog: null,
      fetchImpl: vi
        .fn()
        .mockResolvedValue(
          Response.json({ groups: [{ totals: { "sum(quantity)": 7 } }] }),
        ),
    });
    expect(row(snapshot, "sentry").usage).toMatchObject({
      state: "ready",
      primary: expect.objectContaining({
        value: 7,
        limit: null,
        completeness: "exact",
        risk: "unknown",
      }),
    });
  });
});
