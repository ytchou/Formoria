import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuditRecord } from "../health-agent/contracts";
import {
  buildSpendBlocks,
  humanNumber,
  isEffectivelyUnlimited,
  progressBar,
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
    window: null,
    subject: null,
  },
  upstash: {
    state: "ready" as const,
    risk: "normal" as const,
    value: 100,
    limit: 1000,
    percentage: 0.1,
    projection: 0.4,
    message: null,
    window: null,
    subject: null,
  },
  posthog: {
    state: "ready" as const,
    risk: "normal" as const,
    value: 1000,
    limit: 1_000_000,
    percentage: 0.001,
    projection: 0.01,
    message: null,
    window: null,
    subject: null,
  },
  sentry: {
    state: "ready" as const,
    risk: "normal" as const,
    value: 500,
    limit: 5000,
    percentage: 0.1,
    projection: 0.3,
    message: null,
    window: null,
    subject: null,
  },
  resend: {
    state: "ready" as const,
    risk: "normal" as const,
    value: 80,
    limit: 100,
    percentage: 0.8,
    projection: 0.9,
    message: null,
    window: null,
    subject: null,
  },
  langfuse: {
    state: "ready" as const,
    risk: "normal" as const,
    value: 268568,
    limit: 500_000,
    percentage: 0.537,
    projection: 0.7,
    message: null,
    window: null,
    subject: null,
  },
  github: {
    state: "ready" as const,
    risk: "normal" as const,
    value: 42,
    limit: null,
    percentage: null,
    projection: null,
    message: null,
    window: null,
    subject: null,
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
  return JSON.parse(String(call?.[1]?.body)) as {
    text: string;
    blocks?: Record<string, unknown>[];
  };
}

function allBlockText(
  blocks: Record<string, unknown>[],
): string {
  return JSON.stringify(blocks);
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
    const body = responseBody(fetchImpl, 1);
    expect(body.blocks).toBeDefined();
    expect(Array.isArray(body.blocks)).toBe(true);
    expect(body.text).toContain("$1.23 LLM");
    expect(body.text).toContain("$6.72 cycle");
    const blockJson = allBlockText(body.blocks!);
    expect(blockJson).toContain("$1.23");
    expect(blockJson).toContain("$6.72");
    expect(records.some((record) => record.adapter === "spend-watch")).toBe(
      true,
    );
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
    const blockJson = allBlockText(responseBody(fetchImpl, 1).blocks!);
    expect(blockJson).toContain("OpenAI");
    expect(blockJson).toContain("OpenAI usage is warning.");
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
    const blockJson = allBlockText(responseBody(fetchImpl, 1).blocks!);
    expect(blockJson).toContain("Upstash");
    expect(blockJson).toContain(
      "Upstash Redis secondary usage is critical.",
    );
  });

  // Deploy skew: a report from the build that predates the window field must
  // still render, just without the window label.
  // Deploy skew: the report endpoint may still be the build that predates the
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
          window: null,
          subject: null,
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
    const blockJson = allBlockText(responseBody(fetchImpl, 1).blocks!);
    expect(blockJson).toContain("Upstash");
    expect(blockJson).not.toContain("Failed");
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

    const body = responseBody(fetchImpl, 1);
    const headerBlock = body.blocks?.find(
      (b) => b.type === "header",
    ) as Record<string, unknown> | undefined;
    const headerText = headerBlock?.text as
      | { text: string }
      | undefined;
    expect(headerText?.text).toContain("2026-08-11");
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
    const body = responseBody(fetchImpl, 1);
    expect(body.blocks).toBeDefined();
    const blockJson = allBlockText(body.blocks!);
    expect(blockJson).toContain("HTTP_503");
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
    const blockJson = allBlockText(responseBody(fetchImpl, 1).blocks!);
    expect(blockJson).toContain("InvalidSpendReport");
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

  it("includes quota meter labels in the blocks output", async () => {
    const reportWithOps = { ...report, operations };
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(reportWithOps))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await runSpendReport({
      clock: () => AT,
      env: environment(),
      fetchImpl,
    });

    const blockJson = allBlockText(responseBody(fetchImpl, 1).blocks!);
    expect(blockJson).toContain("PostHog");
    expect(blockJson).toContain("Upstash");
    expect(blockJson).toContain("Sentry");
    expect(blockJson).toContain("Resend");
    expect(blockJson).toContain("Langfuse");
    expect(blockJson).toContain("GitHub Actions");
  });

  it("renders Upstash unlimited limit as 'no cap'", async () => {
    const unlimitedUpstash = {
      ...report,
      operations: {
        ...operations,
        upstash: {
          ...operations.upstash,
          limit: 1e16,
          percentage: null,
        },
      },
    };
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(unlimitedUpstash))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await runSpendReport({
      clock: () => AT,
      env: environment(),
      fetchImpl,
    });

    const blockJson = allBlockText(responseBody(fetchImpl, 1).blocks!);
    expect(blockJson).toContain("no cap");
  });

  it("renders GitHub Actions with null limit as 'no cap'", async () => {
    const reportWithOps = { ...report, operations };
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(reportWithOps))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await runSpendReport({
      clock: () => AT,
      env: environment(),
      fetchImpl,
    });

    const blockJson = allBlockText(responseBody(fetchImpl, 1).blocks!);
    // GitHub Actions has null limit, should show "no cap"
    expect(blockJson).toContain("no cap");
  });
});

describe("humanNumber", () => {
  it("formats 268568 as 269K (rounded)", () => {
    expect(humanNumber(268568)).toBe("268.6K");
  });

  it("formats 1000000 as 1M (exact)", () => {
    expect(humanNumber(1_000_000)).toBe("1M");
  });

  it("formats 42 as 42", () => {
    expect(humanNumber(42)).toBe("42");
  });

  it("formats 1000 as 1K (exact)", () => {
    expect(humanNumber(1_000)).toBe("1K");
  });

  it("formats 1500000 as 1.5M", () => {
    expect(humanNumber(1_500_000)).toBe("1.5M");
  });
});

describe("progressBar", () => {
  it("renders 50% as half-filled", () => {
    expect(progressBar(0.5)).toBe("█████░░░░░");
  });

  it("renders null as all empty", () => {
    expect(progressBar(null)).toBe("░░░░░░░░░░");
  });

  it("renders 0% as all empty", () => {
    expect(progressBar(0)).toBe("░░░░░░░░░░");
  });

  it("renders 100% as all filled", () => {
    expect(progressBar(1)).toBe("██████████");
  });

  it("clamps values above 1", () => {
    expect(progressBar(1.5)).toBe("██████████");
  });
});

describe("isEffectivelyUnlimited", () => {
  it("treats null as unlimited", () => {
    expect(isEffectivelyUnlimited(null)).toBe(true);
  });

  it("treats 1e16 as unlimited", () => {
    expect(isEffectivelyUnlimited(1e16)).toBe(true);
  });

  it("treats 1000 as limited", () => {
    expect(isEffectivelyUnlimited(1000)).toBe(false);
  });
});

describe("buildSpendBlocks", () => {
  it("produces header, context, spend section, divider, and quotas section", () => {
    const reportWithOps = { ...report, operations } as SpendWatchReport;
    const blocks = buildSpendBlocks(reportWithOps);

    const header = blocks.find((b) => b.type === "header");
    expect(header).toBeDefined();
    expect((header?.text as { text: string })?.text).toContain("Formoria spend");

    const contextBlock = blocks.find((b) => b.type === "context");
    expect(contextBlock).toBeDefined();

    const dividers = blocks.filter((b) => b.type === "divider");
    expect(dividers.length).toBeGreaterThanOrEqual(1);

    const sections = blocks.filter((b) => b.type === "section");
    expect(sections.length).toBeGreaterThanOrEqual(2);
  });

  it("includes warnings when needsAttention is true", () => {
    const warningReport = {
      ...report,
      operations: {
        ...operations,
        needsAttention: true,
        warnings: ["OpenAI usage is warning."],
      },
    } as SpendWatchReport;
    const blocks = buildSpendBlocks(warningReport);
    const blockJson = JSON.stringify(blocks);
    expect(blockJson).toContain("OpenAI usage is warning.");
  });

  it("includes lower-bound caveats in context block", () => {
    const reportWithOps = { ...report, operations } as SpendWatchReport;
    const blocks = buildSpendBlocks(reportWithOps);
    const blockJson = JSON.stringify(blocks);
    expect(blockJson).toContain("Resend usage is a lower bound");
  });
});
