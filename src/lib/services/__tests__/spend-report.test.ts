import { describe, expect, it } from "vitest";
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

function createClientDouble({
  aiRows = [],
  auditRows = [],
  calls = [],
}: {
  aiRows?: AiRow[];
  auditRows?: AuditRow[];
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
      const rows = () => (table === "brand_ai_results" ? aiRows : auditRows);
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

    const report = await loadSpendReport(createClientDouble({ calls }), AT);

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
    );

    expect(report.day.llmUsd).toBe(3.75);
    expect(report.day.unpricedCalls).toBe(1);
  });

  it("excludes unmetered services from the dollar total", async () => {
    const report = await loadSpendReport(createClientDouble(), AT);

    expect(report.day.llmUsd).toBe(0);
    expect(report.cycle.derivedUsd).toBe(0);
  });

  it("reports nonLlmDollarsAvailable as false", async () => {
    const report = await loadSpendReport(createClientDouble(), AT);

    expect(report.coverage.nonLlmDollarsAvailable).toBe(false);
  });
});
