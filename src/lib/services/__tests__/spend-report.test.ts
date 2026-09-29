import { afterEach, describe, expect, it, vi } from "vitest";
import type { createServiceClient } from "@/lib/supabase/service";
import type { AuditSpanRow, LlmSpendRow } from "../spend";
import { loadSpendReport } from "../spend-report";

type AiRow = LlmSpendRow & {
  created_at: string;
  raw_response: unknown;
};

type AuditRow = AuditSpanRow & {
  span_id: string;
  started_at: string;
};

type QueryCall = {
  table: string;
  gte: Array<[string, string]>;
  lt: Array<[string, string]>;
  inFilters: Array<[string, unknown[]]>;
  eq: Array<[string, unknown]>;
  not: Array<[string, string, unknown]>;
  neq: Array<[string, unknown]>;
};

type QueryResult = {
  data: unknown[] | null;
  count: number | null;
  error: { message: string } | null;
};

type QueryBuilder = {
  select(columns: string, options?: unknown): QueryBuilder;
  gte(column: string, value: string): QueryBuilder;
  lt(column: string, value: string): QueryBuilder;
  in(column: string, values: unknown[]): QueryBuilder;
  eq(column: string, value: unknown): QueryBuilder;
  not(column: string, operator: string, value: unknown): QueryBuilder;
  neq(column: string, value: unknown): QueryBuilder;
  order(column: string, options?: unknown): QueryBuilder;
  range(from: number, to: number): Promise<QueryResult>;
  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?:
      ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2>;
};

const AT = new Date("2026-08-10T12:00:00.000Z");
const MODEL = "gpt-5.6-luna";

const aiRow = (overrides: Partial<AiRow> & { created_at: string }): AiRow => ({
  model: MODEL,
  cost_usd: 0,
  prompt_tokens: 100,
  completion_tokens: 20,
  raw_response: { ok: true },
  ...overrides,
});

type JevRow = {
  provider: string;
  status: string;
  cost_usd: number | null;
  created_at: string;
};

// Tests never reach the network: the Costs API is injected.
const costsUnavailable = {
  fetchOpenAICosts: () => Promise.reject(new Error("Costs API down")),
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function createClientDouble({
  aiRows = [],
  auditRows = [],
  jevRows = [],
  calls = [],
}: {
  aiRows?: AiRow[];
  auditRows?: AuditRow[];
  jevRows?: JevRow[];
  calls?: QueryCall[];
} = {}) {
  return {
    from(table: string): QueryBuilder {
      const call: QueryCall = {
        table,
        gte: [],
        lt: [],
        inFilters: [],
        eq: [],
        not: [],
        neq: [],
      };
      calls.push(call);
      const builder = {} as QueryBuilder;
      const rows = (): Array<AiRow | AuditRow> =>
        table === "brand_ai_results"
          ? aiRows
          : table === "external_call_audit"
            ? (jevRows as unknown as AuditRow[])
            : auditRows;
      const matches = (row: AiRow | AuditRow) => {
        const timestamp =
          table === "brand_ai_results"
            ? (row as AiRow).created_at
            : (row as AuditRow).started_at;
        const valueFor = (column: string): unknown => {
          if (column === "raw_response->>ok") {
            return (row as AiRow).raw_response &&
              typeof (row as AiRow).raw_response === "object"
              ? ((row as AiRow).raw_response as { ok?: unknown }).ok
              : undefined;
          }
          return row[column as keyof (AiRow | AuditRow)];
        };
        return (
          call.gte.every(([column, value]) =>
            valueFor(column) !== undefined
              ? String(valueFor(column)) >= value
              : timestamp >= value,
          ) &&
          call.lt.every(([column, value]) =>
            valueFor(column) !== undefined
              ? String(valueFor(column)) < value
              : timestamp < value,
          ) &&
          call.inFilters.every(([column, values]) =>
            values.some((candidate) => valueFor(column) === candidate),
          ) &&
          call.eq.every(([column, value]) => valueFor(column) === value) &&
          call.not.every(([column, operator, value]) => {
            if (operator === "is" && value === null) {
              return valueFor(column) !== null;
            }
            return true;
          }) &&
          call.neq.every(([column, value]) => valueFor(column) !== value)
        );
      };
      const result = () => {
        const matched = rows().filter(matches);
        return { data: matched, count: matched.length, error: null };
      };
      builder.select = () => builder;
      builder.gte = (column, value) => {
        call.gte.push([column, value]);
        return builder;
      };
      builder.lt = (column, value) => {
        call.lt.push([column, value]);
        return builder;
      };
      builder.in = (column, values) => {
        call.inFilters.push([column, values]);
        return builder;
      };
      builder.eq = (column, value) => {
        call.eq.push([column, value]);
        return builder;
      };
      builder.not = (column, operator, value) => {
        call.not.push([column, operator, value]);
        return builder;
      };
      builder.neq = (column, value) => {
        call.neq.push([column, value]);
        return builder;
      };
      builder.order = () => builder;
      builder.range = async (from, to) => {
        const page = result();
        return { ...page, data: page.data?.slice(from, to + 1) ?? null };
      };
      builder.then = (onfulfilled, onrejected) =>
        Promise.resolve(result()).then(onfulfilled, onrejected);
      return builder;
    },
  } as unknown as ReturnType<typeof createServiceClient>;
}

describe("daily spend report", () => {
  it("uses a trailing 24h day window and the reset-day cycle window", async () => {
    const calls: QueryCall[] = [];

    const report = await loadSpendReport(
      createClientDouble({ calls }),
      AT,
      costsUnavailable,
    );

    expect(report.day.end).toBe(AT.toISOString());
    expect(report.day.start).toBe("2026-08-09T12:00:00.000Z");
    expect(report.cycle.start).toBe("2026-08-01T00:00:00.000Z");
    expect(report.cycle.end).toBe("2026-09-01T00:00:00.000Z");
    expect(calls.some((call) => call.gte[0]?.[1] === report.day.start)).toBe(
      true,
    );
    expect(calls.some((call) => call.gte[0]?.[1] === report.cycle.start)).toBe(
      true,
    );
  });

  it("counts a null cost_usd as unpriced and never sums it as zero", async () => {
    const report = await loadSpendReport(
      createClientDouble({
        aiRows: [
          aiRow({
            created_at: "2026-08-10T10:00:00.000Z",
            cost_usd: 1.25,
          }),
          aiRow({
            created_at: "2026-08-10T11:00:00.000Z",
            cost_usd: 2.5,
          }),
          aiRow({
            created_at: "2026-08-10T11:30:00.000Z",
            cost_usd: null,
          }),
        ],
      }),
      AT,
      costsUnavailable,
    );

    expect(report.day.llmUsd).toBe(3.75);
    expect(report.day.unpricedCalls).toBe(1);
  });

  it("excludes unmetered services from the dollar total", async () => {
    const report = await loadSpendReport(
      createClientDouble(),
      AT,
      costsUnavailable,
    );

    expect(report.day.llmUsd).toBe(0);
    expect(report.cycle.derivedUsd).toBe(0);
  });

  it("reports nonLlmDollarsAvailable as false", async () => {
    const report = await loadSpendReport(
      createClientDouble(),
      AT,
      costsUnavailable,
    );

    expect(report.coverage.nonLlmDollarsAvailable).toBe(false);
  });
});

describe("OpenAI billed spend", () => {
  const configureAdminKey = () => vi.stubEnv("OPENAI_ADMIN_KEY", "admin-key");
  const day = (start: string, usd: number) => ({
    start,
    end: new Date(Date.parse(start) + 86_400_000).toISOString(),
    usd,
  });

  // Bug caught: the report showed production-derived spend as the OpenAI
  // figure while real spend (staging, evals) went unreported.
  it("reports the previous UTC day and cycle-to-date from one Costs API call", async () => {
    configureAdminKey();
    const windows: Array<{ startTime: Date; endTime: Date }> = [];
    const report = await loadSpendReport(createClientDouble(), AT, {
      fetchOpenAICosts: async (window) => {
        windows.push(window);
        return {
          totalUsd: 6,
          days: [
            day("2026-08-01T00:00:00.000Z", 1),
            day("2026-08-09T00:00:00.000Z", 2),
            day("2026-08-10T00:00:00.000Z", 3),
          ],
        };
      },
    });

    expect(windows).toEqual([
      { startTime: new Date("2026-08-01T00:00:00.000Z"), endTime: AT },
    ]);
    expect(report.openaiBilled).toEqual({
      dayUsd: 2,
      cycleUsd: 6,
      dayStart: "2026-08-09T00:00:00.000Z",
      dayEnd: "2026-08-10T00:00:00.000Z",
    });
    expect(report.operations?.openai?.value).toBe(6);
  });

  it("widens the range on the cycle's first day so yesterday is still billed", async () => {
    configureAdminKey();
    const at = new Date("2026-08-01T21:05:00.000Z");
    const windows: Array<{ startTime: Date; endTime: Date }> = [];
    const report = await loadSpendReport(createClientDouble(), at, {
      fetchOpenAICosts: async (window) => {
        windows.push(window);
        return {
          totalUsd: 5,
          days: [
            day("2026-07-31T00:00:00.000Z", 4),
            day("2026-08-01T00:00:00.000Z", 1),
          ],
        };
      },
    });

    expect(windows[0]?.startTime).toEqual(new Date("2026-07-31T00:00:00.000Z"));
    expect(report.openaiBilled).toMatchObject({ dayUsd: 4, cycleUsd: 1 });
  });

  it("is null and logged when a configured Costs API read fails", async () => {
    configureAdminKey();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const report = await loadSpendReport(
      createClientDouble(),
      AT,
      costsUnavailable,
    );

    expect(report.openaiBilled).toBeNull();
    expect(errors).toHaveBeenCalledWith(
      expect.stringContaining("spend_report_openai_costs_unavailable"),
    );
  });

  // Bug caught: an unset OPENAI_ADMIN_KEY (the optional feature, not yet
  // configured) logged an error and raised a daily "unavailable" warning.
  it("is absent, unlogged, and never fetched when OPENAI_ADMIN_KEY is unset", async () => {
    for (const key of ["", "   "]) {
      vi.stubEnv("OPENAI_ADMIN_KEY", key);
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      let fetched = false;
      const report = await loadSpendReport(createClientDouble(), AT, {
        fetchOpenAICosts: () => {
          fetched = true;
          return Promise.reject(new Error("unreachable"));
        },
      });

      expect(report.openaiBilled).toBeUndefined();
      expect(fetched).toBe(false);
      expect(errors).not.toHaveBeenCalledWith(
        expect.stringContaining("spend_report_openai_costs_unavailable"),
      );
    }
  });
});

describe("Jev derived spend", () => {
  it("sums succeeded Jev rows for the day and cycle windows", async () => {
    const jevRow = (
      created_at: string,
      cost_usd: number | null,
      status = "succeeded",
    ): JevRow => ({ provider: "typesafe", status, cost_usd, created_at });
    const calls: QueryCall[] = [];
    const report = await loadSpendReport(
      createClientDouble({
        calls,
        jevRows: [
          jevRow("2026-08-02T00:00:00.000Z", 1),
          jevRow("2026-08-10T10:00:00.000Z", null, "started"),
          jevRow("2026-08-10T10:00:01.000Z", 0.5),
          jevRow("2026-08-10T11:00:00.000Z", null),
        ],
      }),
      AT,
      costsUnavailable,
    );

    expect(report.jev).toEqual({
      dayUsd: 0.5,
      cycleUsd: 1.5,
      unpricedCalls: 1,
    });
    // One read covers both windows.
    expect(
      calls.filter(
        (call) =>
          call.table === "external_call_audit" &&
          call.eq.some(([column, value]) => column === "provider" && value === "typesafe"),
      ),
    ).toHaveLength(1);
  });
});
