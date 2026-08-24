import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assessUsageRisk,
  buildOperationalAlertSummary,
  buildOperationalSnapshot,
  fetchUpstashUsage,
  loadOperationalSnapshot,
  parseSentryAcceptedCount,
  parseUpstashDatabase,
  parseUpstashStats,
  type UsageMetricInput,
} from "./operational-usage";

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
