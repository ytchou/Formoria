import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuditRecord } from "../health-agent/contracts";
import {
  runSpendReport,
  type SpendWatchEnvironment,
  type SpendWatchReport,
} from "./report";

const ORIGIN_SECRET = "origin-secret-7f4c3b29";
const WEBHOOK_URL = "https://hooks.slack.test/services/private-webhook";
const BASE_URL = "https://formoria.test";
const AT = Date.parse("2026-08-11T00:00:00.000Z");

const report: SpendWatchReport = {
  schemaVersion: 1,
  generatedAt: "2026-08-11T00:00:00.000Z",
  day: {
    start: "2026-08-10T00:00:00.000Z",
    end: "2026-08-11T00:00:00.000Z",
    llmUsd: 1.23,
    lines: [
      {
        id: "openai",
        amountUsd: 1.23,
        units: 1_234,
        unitLabel: "tokens",
      },
      {
        id: "serper",
        amountUsd: 0,
        units: 41,
        unitLabel: "credits / cycle",
      },
      {
        id: "resend",
        amountUsd: 0,
        units: 2,
        unitLabel: "sends / cycle",
      },
    ],
    unpricedCalls: 0,
  },
  cycle: {
    start: "2026-08-01T00:00:00.000Z",
    end: "2026-09-01T00:00:00.000Z",
    derivedUsd: 6.72,
    declaredMonthlyUsd: 75,
  },
  coverage: {
    unmeteredServices: 16,
    unpricedCalls: 0,
    inFlightCalls: 0,
    nonLlmDollarsAvailable: false,
  },
};

const operations = {
  needsAttention: false,
  unavailableUpstash: false,
  warnings: [],
  lowerBoundCaveats: ["Resend usage is a lower bound from local measurements."],
  openai: {
    state: "ready" as const,
    risk: "normal" as const,
    value: 1.23,
    limit: 25,
    percentage: 0.0492,
    projection: 0.2,
    message: null,
  },
  upstash: {
    state: "ready" as const,
    risk: "normal" as const,
    value: 100,
    limit: 1000,
    percentage: 0.1,
    projection: 0.4,
    message: null,
  },
  posthog: {
    state: "ready" as const,
    risk: "normal" as const,
    value: 1000,
    limit: 1_000_000,
    percentage: 0.001,
    projection: 0.01,
    message: null,
  },
};

function environment(
  overrides: Partial<SpendWatchEnvironment> = {},
): SpendWatchEnvironment {
  return {
    FORMORIA_RAILWAY_URL: BASE_URL,
    ORIGIN_SECRET,
    SLACK_HEALTH_WEBHOOK_URL: WEBHOOK_URL,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function auditLog(): {
  records: AuditRecord[];
  audit: (record: AuditRecord) => void;
} {
  const records: AuditRecord[] = [];
  return { records, audit: (record) => records.push(record) };
}

function responseBody(fetchImpl: ReturnType<typeof vi.fn>, index: number) {
  const call = fetchImpl.mock.calls[index];
  return JSON.parse(String(call?.[1]?.body)) as { text: string };
}

afterEach(() => {
  process.exitCode = undefined;
});

describe("spend-watch report", () => {
  it("sends a spend digest on a successful response", async () => {
    const { audit, records } = auditLog();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(report))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const result = await runSpendReport({
      audit,
      clock: () => AT,
      env: environment(),
      fetchImpl,
    });

    expect(result.status).not.toBe("failed");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      `${BASE_URL}/api/cron/spend-report`,
    );
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({
      headers: { "x-origin-verify": ORIGIN_SECRET },
      method: "POST",
    });
    const text = responseBody(fetchImpl, 1).text;
    expect(text).toContain("Yesterday: $1.23 derived");
    expect(text).toContain("Cycle to date: $6.72 derived");
    expect(text).toContain("41 credits $0.00");
    expect(text).toContain("2 sends $0.00");
    expect(records.some((record) => record.adapter === "slack")).toBe(true);
  });

  it("marks warning usage as needs_attention while still delivering the report", async () => {
    const warningReport = {
      ...report,
      operations: {
        ...operations,
        needsAttention: true,
        warnings: ["OpenAI usage is warning."],
        openai: {
          ...operations.openai,
          risk: "warning" as const,
          value: 18,
          percentage: 0.72,
        },
      },
    };
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(warningReport))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const result = await runSpendReport({
      env: environment(),
      clock: () => AT,
      fetchImpl,
    });

    expect(result.status).toBe("needs_attention");
    expect(responseBody(fetchImpl, 1).text).toContain("OpenAI budget");
    expect(responseBody(fetchImpl, 1).text).toContain(
      "OpenAI usage is warning.",
    );
  });

  it("delivers a critical usage report as needs_attention, not failed", async () => {
    const criticalReport = {
      ...report,
      operations: {
        ...operations,
        needsAttention: true,
        warnings: ["Upstash Redis secondary usage is critical."],
        upstash: {
          ...operations.upstash,
          risk: "critical" as const,
          value: 950,
          percentage: 0.95,
        },
      },
    };
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(criticalReport))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const result = await runSpendReport({
      env: environment(),
      clock: () => AT,
      fetchImpl,
    });

    expect(result.status).toBe("needs_attention");
    expect(responseBody(fetchImpl, 1).text).toContain("Upstash commands");
    expect(responseBody(fetchImpl, 1).text).toContain("critical");
    expect(responseBody(fetchImpl, 1).text).toContain(
      "Upstash Redis secondary usage is critical.",
    );
  });

  // Bug caught: Railway egress rendered through the integer unit formatter,
  // which rounded a 1.2 GB day away to "1".
  it("renders the Railway egress line with GB units", async () => {
    const railwayReport = {
      ...report,
      operations: {
        ...operations,
        railway: {
          state: "ready" as const,
          risk: "normal" as const,
          value: 1.2,
          limit: 5,
          percentage: 0.24,
          projection: null,
          message: null,
        },
      },
    };
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(railwayReport))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const result = await runSpendReport({
      env: environment(),
      clock: () => AT,
      fetchImpl,
    });

    expect(result.status).not.toBe("failed");
    const text = responseBody(fetchImpl, 1).text;
    expect(text).toContain("Railway egress");
    expect(text).toContain("1.2");
    expect(text).toContain("5");
  });

  it("marks warning Railway usage as needs_attention while still delivering", async () => {
    const warningReport = {
      ...report,
      operations: {
        ...operations,
        needsAttention: true,
        warnings: ["Railway Formoria app usage is warning."],
        railway: {
          state: "ready" as const,
          risk: "warning" as const,
          value: 3.6,
          limit: 5,
          percentage: 0.72,
          projection: null,
          message: null,
        },
      },
    };
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(warningReport))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const result = await runSpendReport({
      env: environment(),
      clock: () => AT,
      fetchImpl,
    });

    expect(result.status).toBe("needs_attention");
    const text = responseBody(fetchImpl, 1).text;
    expect(text).toContain("Railway egress");
    expect(text).toContain("Railway Formoria app usage is warning.");
  });

  // Deploy skew: the report endpoint may still be the build that predates the
  // Railway meter, and an absent key must not fail schema validation.
  it("accepts a response without a railway key", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ ...report, operations: { ...operations } }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        jsonResponse({
          ...report,
          operations: { ...operations, railway: null },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const absent = await runSpendReport({
      env: environment(),
      clock: () => AT,
      fetchImpl,
    });
    const explicitNull = await runSpendReport({
      env: environment(),
      clock: () => AT,
      fetchImpl,
    });

    expect(absent.status).not.toBe("failed");
    expect(explicitNull.status).not.toBe("failed");
    expect(responseBody(fetchImpl, 1).text).not.toContain("InvalidSpendReport");
  });

  it("surfaces unavailable Upstash monitoring as needs_attention, not failed", async () => {
    const unavailableReport = {
      ...report,
      operations: {
        ...operations,
        needsAttention: true,
        unavailableUpstash: true,
        upstash: {
          state: "unconfigured" as const,
          risk: "unknown" as const,
          value: null,
          limit: null,
          percentage: null,
          projection: null,
          message: "Upstash monitoring credentials are not configured.",
        },
      },
    };
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(unavailableReport))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const result = await runSpendReport({
      env: environment(),
      clock: () => AT,
      fetchImpl,
    });

    expect(result.status).toBe("needs_attention");
    expect(responseBody(fetchImpl, 1).text).toContain("Upstash commands");
    expect(responseBody(fetchImpl, 1).text).not.toContain("Failed");
  });

  it("labels the scheduled report with the Taipei calendar date", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          ...report,
          generatedAt: "2026-08-10T23:30:00.000Z",
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await runSpendReport({
      clock: () => AT,
      env: environment(),
      fetchImpl,
    });

    expect(responseBody(fetchImpl, 1).text).toContain("spend — 2026-08-11");
  });

  it("sends a failed notification and exits non-zero on a non-2xx response", async () => {
    const { audit } = auditLog();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response("upstream unavailable", { status: 503 }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const result = await runSpendReport({
      audit,
      clock: () => AT,
      env: environment(),
      fetchImpl,
    });

    expect(result.status).toBe("failed");
    expect(process.exitCode).toBe(1);
    expect(responseBody(fetchImpl, 1).text).toContain("HTTP_503");
  });

  it("sends a failed notification when a successful response is malformed", async () => {
    const malformed = {
      ...report,
      day: { ...report.day, lines: [null] },
    };
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(malformed))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const result = await runSpendReport({
      clock: () => AT,
      env: environment(),
      fetchImpl,
    });

    expect(result.status).toBe("failed");
    expect(process.exitCode).toBe(1);
    expect(responseBody(fetchImpl, 1).text).toContain("InvalidSpendReport");
  });

  it("fails loudly when a required credential is missing", async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(
      runSpendReport({
        clock: () => AT,
        env: environment({ ORIGIN_SECRET: undefined }),
        fetchImpl,
      }),
    ).rejects.toThrow("ORIGIN_SECRET");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("propagates a non-zero exit when Slack itself throws", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(report))
      .mockRejectedValueOnce(new Error("slack is unreachable"));

    await expect(
      runSpendReport({
        clock: () => AT,
        env: environment(),
        fetchImpl,
      }),
    ).rejects.toThrow();
    expect(process.exitCode).toBe(1);
  });

  it("never writes a secret or the webhook URL into the audit record", async () => {
    const { audit, records } = auditLog();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(report))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await runSpendReport({
      audit,
      clock: () => AT,
      env: environment(),
      fetchImpl,
    });

    const auditJson = JSON.stringify(records);
    expect(auditJson).not.toContain(ORIGIN_SECRET);
    expect(auditJson).not.toContain(WEBHOOK_URL);
  });
});
