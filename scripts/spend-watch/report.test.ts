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
