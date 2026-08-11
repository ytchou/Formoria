import { describe, expect, it } from "vitest";
import type { ServiceEntry } from "../service-registry";
import {
  buildSpendSnapshot,
  countBillableLlmRows,
  cycleForResetDay,
  loadAllPages,
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
