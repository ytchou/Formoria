import { describe, expect, it, vi } from "vitest";

// A retired model must still be counted in the openai window. Mocking the
// constants module (not a service) keeps check-test-boundaries green.
vi.mock("@/lib/constants/llm-models", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/constants/llm-models")>()),
  RETIRED_OPENAI_MODELS: ["gpt-old"],
}));
import type { ServiceEntry } from "../service-registry";
import {
  buildSpendSnapshot,
  countBillableLlmRows,
  cycleForResetDay,
  loadAllPages,
  loadJevSpend,
  openaiModels,
  type AuditSpanRow,
  type LlmSpendRow,
} from "../spend";

const AT = new Date("2026-08-10T12:00:00.000Z");

function service(
  id: string,
  overrides: Partial<ServiceEntry> = {},
): ServiceEntry {
  return {
    id,
    name: id,
    vendor: "Example provider",
    category: "tooling",
    criticality: "back-office",
    operationalSection: "back-office",
    operationalKind: "dependency",
    envVars: [],
    status: "active",
    plan: {
      kind: "usage",
      asOf: "2026-08-10",
      sourceUrl: "https://provider.example/pricing",
    },
    ...overrides,
  };
}

function snapshot({
  registry,
  llmRows = [],
  billableRows = [],
  auditSpans = [],
}: {
  registry: ServiceEntry[];
  llmRows?: LlmSpendRow[];
  billableRows?: Array<{ model: string; raw_response: unknown }>;
  auditSpans?: AuditSpanRow[];
}) {
  return buildSpendSnapshot({
    registry,
    llmRows,
    billableCallsByModel: countBillableLlmRows(billableRows),
    auditSpans,
    at: AT,
  });
}

describe("spend snapshot", () => {
  // Bug caught: PostgREST's 1,000-row response cap silently truncated cycle spend.
  it("loads every page when the database caps a response", async () => {
    const rows = Array.from({ length: 2501 }, (_, id) => ({ id }));

    await expect(
      loadAllPages((from, to) =>
        Promise.resolve({
          data: rows.slice(from, to + 1),
          count: rows.length,
          error: null,
        }),
      ),
    ).resolves.toHaveLength(2501);
  });

  it("builds a cycle starting on the registry reset day", () => {
    expect(cycleForResetDay(AT, 19)).toEqual({
      resetsOnDay: 19,
      start: "2026-07-19T00:00:00.000Z",
      end: "2026-08-19T00:00:00.000Z",
    });
    expect(cycleForResetDay(AT, 1)).toEqual({
      resetsOnDay: 1,
      start: "2026-08-01T00:00:00.000Z",
      end: "2026-09-01T00:00:00.000Z",
    });
  });

  it("sums priced LLM cost and counts unpriced separately", () => {
    const result = snapshot({
      registry: [service("openai", { meter: "llm-tokens" })],
      llmRows: [
        {
          model: "gpt-5.6-luna",
          cost_usd: 1.25,
          prompt_tokens: 100,
          completion_tokens: 20,
        },
        {
          model: "gpt-5.6-luna",
          cost_usd: 2.5,
          prompt_tokens: 200,
          completion_tokens: 30,
        },
      ],
      billableRows: [
        { model: "gpt-5.6-luna", raw_response: { ok: true } },
        { model: "gpt-5.6-luna", raw_response: { ok: true } },
        { model: "gpt-5.6-luna", raw_response: { ok: true } },
      ],
    });

    expect(result.services.at(0)).toMatchObject({
      amountUsd: 3.75,
      units: 350,
      pricingCoverage: 2 / 3,
    });
    expect(result.coverage.unpricedCalls).toBe(1);
  });

  it("includes retired models in the openai window", () => {
    expect(openaiModels()).toContain("gpt-old");

    const result = snapshot({
      registry: [service("openai", { meter: "llm-tokens" })],
      llmRows: [
        {
          model: "gpt-5.6-luna",
          cost_usd: 1,
          prompt_tokens: 10,
          completion_tokens: 0,
        },
        {
          model: "gpt-old",
          cost_usd: 2,
          prompt_tokens: 20,
          completion_tokens: 0,
        },
      ],
      billableRows: [
        { model: "gpt-5.6-luna", raw_response: { ok: true } },
        { model: "gpt-old", raw_response: { ok: true } },
      ],
    });

    expect(result.services.at(0)).toMatchObject({
      amountUsd: 3,
      units: 30,
      pricingCoverage: 1,
    });
  });

  it("excludes verdict rows and non-2xx calls from the billable denominator", () => {
    const billableCallsByModel = countBillableLlmRows([
      { model: "gpt-5.6-luna", raw_response: { ok: true } },
      { model: "gpt-5.6-luna", raw_response: null },
      { model: "gpt-5.6-luna", raw_response: { ok: false, status: 429 } },
    ]);
    const result = buildSpendSnapshot({
      registry: [service("openai", { meter: "llm-tokens" })],
      llmRows: [
        {
          model: "gpt-5.6-luna",
          cost_usd: 0.5,
          prompt_tokens: 10,
          completion_tokens: 5,
        },
      ],
      billableCallsByModel,
      auditSpans: [],
      at: AT,
    });

    expect(result.services.at(0)?.pricingCoverage).toBe(1);
    expect(result.coverage.unpricedCalls).toBe(0);
  });

  it("counts in-flight spans separately from failures", () => {
    const result = snapshot({
      registry: [
        service("serper", {
          meter: "serper-credits",
          quota: {
            metric: "Search credits",
            included: 2500,
            unit: "credits / cycle",
            overageUsdPerUnit: 0.02,
            cycleResetsOnDay: 1,
          },
        }),
      ],
      auditSpans: [
        { provider: "serper", kind: "external", terminal_status: null },
        { provider: "serper", kind: "external", terminal_status: "failed" },
      ],
    });

    expect(result.services.at(0)?.units).toBe(1);
    expect(result.coverage.inFlightCalls).toBe(1);
  });

  it("computes quota overage only above the included allowance", () => {
    const registry = [
      service("serper", {
        meter: "serper-credits",
        quota: {
          metric: "Search credits",
          included: 2500,
          unit: "credits / cycle",
          overageUsdPerUnit: 0.02,
          cycleResetsOnDay: 1,
        },
      }),
    ];
    const spans = (count: number): AuditSpanRow[] =>
      Array.from({ length: count }, () => ({
        provider: "serper",
        kind: "external",
        terminal_status: "succeeded",
      }));

    expect(
      snapshot({ registry, auditSpans: spans(311) }).services.at(0)?.amountUsd,
    ).toBe(0);
    expect(
      snapshot({ registry, auditSpans: spans(2600) }).services.at(0)?.amountUsd,
    ).toBe(2);
  });

  // Bug caught: removing Serper's unverified denominator also removed its measured successful-credit count from Spend Watch.
  it("keeps measured provider units when no authoritative quota exists", () => {
    const result = snapshot({
      registry: [service("serper", { meter: "serper-credits" })],
      auditSpans: [
        { provider: "serper", kind: "external", terminal_status: "succeeded" },
        { provider: "serper", kind: "external", terminal_status: "failed" },
        { provider: "serper", kind: "external", terminal_status: null },
      ],
    });

    expect(result.services.at(0)).toMatchObject({
      amountUsd: 0,
      units: 1,
      unitLabel: "credits",
      quotaUsedRatio: null,
    });
  });

  it("marks services with no meter as unmetered with a null amount", () => {
    const result = snapshot({ registry: [service("railway")] });

    expect(result.services.at(0)).toMatchObject({
      provenance: "unmetered",
      amountUsd: null,
    });
  });

  it("reports nonLlmDollarsAvailable as false", () => {
    const result = snapshot({ registry: [service("railway")] });

    expect(result.coverage.nonLlmDollarsAvailable).toBe(false);
  });
});

describe("Jev derived spend", () => {
  type AuditRow = {
    provider: string;
    status: string;
    cost_usd: number | string | null;
    created_at: string;
  };

  function auditClient(rows: AuditRow[], tables: string[] = []) {
    return {
      from(table: string) {
        tables.push(table);
        const eq: Array<[string, unknown]> = [];
        let gte = "";
        let lt = "";
        const matched = () =>
          rows.filter(
            (row) =>
              eq.every(
                ([column, value]) => row[column as keyof AuditRow] === value,
              ) &&
              row.created_at >= gte &&
              row.created_at < lt,
          );
        const builder = {
          select: () => builder,
          eq: (column: string, value: unknown) => {
            eq.push([column, value]);
            return builder;
          },
          gte: (_column: string, value: string) => {
            gte = value;
            return builder;
          },
          lt: (_column: string, value: string) => {
            lt = value;
            return builder;
          },
          order: () => builder,
          range: async (from: number, to: number) => {
            const all = matched();
            return {
              data: all.slice(from, to + 1),
              count: all.length,
              error: null,
            };
          },
        };
        return builder;
      },
    } as unknown as Parameters<typeof loadJevSpend>[0];
  }

  // Bug caught: counting the `started` row (cost null) double-counts every
  // call and reports each one as unpriced.
  it("sums succeeded typesafe rows only and counts null-cost rows as unpriced", async () => {
    const tables: string[] = [];
    const client = auditClient(
      [
        { provider: "typesafe", status: "started", cost_usd: null, created_at: "2026-08-10T01:00:00.000Z" },
        { provider: "typesafe", status: "succeeded", cost_usd: "0.40", created_at: "2026-08-10T01:00:01.000Z" },
        { provider: "typesafe", status: "succeeded", cost_usd: 0.1, created_at: "2026-08-10T02:00:00.000Z" },
        { provider: "typesafe", status: "succeeded", cost_usd: null, created_at: "2026-08-10T03:00:00.000Z" },
        { provider: "typesafe", status: "failed", cost_usd: 9, created_at: "2026-08-10T04:00:00.000Z" },
        { provider: "openai", status: "succeeded", cost_usd: 9, created_at: "2026-08-10T05:00:00.000Z" },
        { provider: "typesafe", status: "succeeded", cost_usd: 9, created_at: "2026-08-11T00:00:00.000Z" },
      ],
      tables,
    );

    const [spend] = await loadJevSpend(client, [
      { start: "2026-08-10T00:00:00.000Z", end: "2026-08-11T00:00:00.000Z" },
    ]);

    expect(spend?.usd).toBeCloseTo(0.5);
    expect(spend?.calls).toBe(3);
    expect(spend?.unpricedCalls).toBe(1);
    expect(tables).toEqual(["external_call_audit"]);
  });

  // Bug caught: the day and cycle sums were two full reads of the same rows.
  it("reads once over the union of windows and splits the sums by created_at", async () => {
    const tables: string[] = [];
    const client = auditClient(
      [
        // Before the day window, inside the cycle.
        { provider: "typesafe", status: "succeeded", cost_usd: 1, created_at: "2026-08-01T00:00:00.000Z" },
        // Inside both windows.
        { provider: "typesafe", status: "succeeded", cost_usd: 0.25, created_at: "2026-08-10T12:00:00.000Z" },
        { provider: "typesafe", status: "succeeded", cost_usd: null, created_at: "2026-08-10T13:00:00.000Z" },
        // Previous cycle, inside the day window (the cycle's first day).
        { provider: "typesafe", status: "succeeded", cost_usd: 2, created_at: "2026-07-31T23:00:00.000Z" },
      ],
      tables,
    );

    const [day, cycle] = await loadJevSpend(client, [
      { start: "2026-07-31T12:00:00.000Z", end: "2026-08-11T00:00:00.000Z" },
      { start: "2026-08-01T00:00:00.000Z", end: "2026-09-01T00:00:00.000Z" },
    ]);

    expect(day?.usd).toBeCloseTo(3.25);
    expect(day?.unpricedCalls).toBe(1);
    expect(cycle?.usd).toBeCloseTo(1.25);
    expect(cycle?.calls).toBe(3);
    expect(tables).toEqual(["external_call_audit"]);
  });
});
