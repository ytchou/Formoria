import { LLM_MODELS } from "@/lib/constants/llm-models";
import {
  SERVICE_REGISTRY,
  type ServiceEntry,
  type ServiceMeter,
} from "@/lib/services/service-registry";
import { createServiceClient } from "@/lib/supabase/service";

export type SpendProvenance = "declared" | "derived" | "unmetered";

export type SpendLine = {
  id: string;
  provenance: SpendProvenance;
  amountUsd: number | null;
  units: number | null;
  unitLabel: string | null;
  quotaUsedRatio: number | null;
  asOf: string | null;
  pricingCoverage: number | null;
};

export type SpendSnapshotV1 = {
  schemaVersion: 1;
  generatedAt: string;
  cycles: SpendCycle[];
  services: SpendLine[];
  totals: { declaredMonthlyUsd: number; derivedCycleUsd: number };
  coverage: {
    unmeteredServices: number;
    unpricedCalls: number;
    inFlightCalls: number;
    nonLlmDollarsAvailable: false;
  };
};

export type SpendCycle = {
  resetsOnDay: number;
  start: string;
  end: string;
};

export type LlmSpendRow = {
  model: string;
  cost_usd: number | string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
};

export type AuditSpanRow = {
  provider: string;
  kind: string;
  terminal_status: string | null;
};

const CACHE_TTL_MS = 5 * 60_000;
const DEEPSEEK_MODELS = ["deepseek-v4-flash"] as const;
const AUDITED_METER_PROVIDERS = ["serper", "resend"] as const;

function startOfCycle(at: Date, resetsOnDay: number): Date {
  const year = at.getUTCFullYear();
  const month = at.getUTCMonth();
  const currentMonthStart = new Date(Date.UTC(year, month, resetsOnDay));
  return at >= currentMonthStart
    ? currentMonthStart
    : new Date(Date.UTC(year, month - 1, resetsOnDay));
}

export function cycleForResetDay(at: Date, resetsOnDay: number): SpendCycle {
  const start = startOfCycle(at, resetsOnDay);
  const end = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, resetsOnDay),
  );
  return {
    resetsOnDay,
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

export function countBillableLlmRows(
  rows: Array<{ model: string; raw_response: unknown }>,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    if (
      !row.raw_response ||
      typeof row.raw_response !== "object" ||
      Array.isArray(row.raw_response) ||
      (row.raw_response as { ok?: unknown }).ok !== true
    ) {
      continue;
    }
    counts[row.model] = (counts[row.model] ?? 0) + 1;
  }
  return counts;
}

function modelsForService(id: string): readonly string[] {
  if (id === "deepseek") return DEEPSEEK_MODELS;
  if (id === "openai") return [...new Set(Object.values(LLM_MODELS))];
  return [];
}

function meterProvider(meter: ServiceMeter): string | null {
  if (meter === "serper-credits") return "serper";
  if (meter === "resend-sends") return "resend";
  return null;
}

function derivedMeterLine({
  entry,
  llmRows,
  billableCallsByModel,
  auditSpans,
}: {
  entry: ServiceEntry;
  llmRows: LlmSpendRow[];
  billableCallsByModel: Readonly<Record<string, number>>;
  auditSpans: AuditSpanRow[];
}): Omit<SpendLine, "id" | "provenance" | "asOf"> & {
  unpricedCalls: number;
} {
  if (entry.meter === "llm-tokens") {
    const models = new Set(modelsForService(entry.id));
    const rows = llmRows.filter((row) => models.has(row.model));
    let amountUsd = 0;
    let units = 0;
    let pricedCalls = 0;

    // Documented shortcut: JS aggregation; move to a Postgres RPC above ~50k rows/cycle.
    for (const row of rows) {
      if (row.cost_usd !== null) {
        amountUsd += Number(row.cost_usd);
        pricedCalls += 1;
      }
      units += (row.prompt_tokens ?? 0) + (row.completion_tokens ?? 0);
    }
    const billableCalls = [...models].reduce(
      (total, model) => total + (billableCallsByModel[model] ?? 0),
      0,
    );
    const unpricedCalls = Math.max(0, billableCalls - pricedCalls);
    return {
      amountUsd,
      units,
      unitLabel: "tokens",
      quotaUsedRatio: null,
      pricingCoverage:
        billableCalls === 0 ? 1 : Math.min(1, pricedCalls / billableCalls),
      unpricedCalls,
    };
  }

  const provider = entry.meter ? meterProvider(entry.meter) : null;
  if (provider && entry.quota) {
    const units = auditSpans.filter(
      (span) =>
        span.provider === provider &&
        span.kind !== "service" &&
        span.terminal_status !== null,
    ).length;
    return {
      amountUsd:
        Math.max(0, units - entry.quota.included) *
        entry.quota.overageUsdPerUnit,
      units,
      unitLabel: entry.quota.unit,
      quotaUsedRatio:
        entry.quota.included === 0 ? null : units / entry.quota.included,
      pricingCoverage: null,
      unpricedCalls: 0,
    };
  }

  return {
    amountUsd: 0,
    units: null,
    unitLabel: null,
    quotaUsedRatio: null,
    pricingCoverage: null,
    unpricedCalls: 0,
  };
}

export function buildSpendSnapshot({
  registry = SERVICE_REGISTRY,
  llmRows,
  billableCallsByModel,
  auditSpans,
  at,
}: {
  registry?: readonly ServiceEntry[];
  llmRows: LlmSpendRow[];
  billableCallsByModel: Readonly<Record<string, number>>;
  auditSpans: AuditSpanRow[];
  at: Date;
}): SpendSnapshotV1 {
  const resetDays = new Set([1]);
  for (const entry of registry) {
    if (entry.quota) resetDays.add(entry.quota.cycleResetsOnDay);
  }

  let derivedCycleUsd = 0;
  let unpricedCalls = 0;
  const services = registry.map((entry): SpendLine => {
    const derived = derivedMeterLine({
      entry,
      llmRows,
      billableCallsByModel,
      auditSpans,
    });
    derivedCycleUsd += entry.meter ? derived.amountUsd ?? 0 : 0;
    unpricedCalls += derived.unpricedCalls;

    if (entry.plan.monthlyUsd !== undefined) {
      return {
        id: entry.id,
        provenance: "declared",
        amountUsd: entry.plan.monthlyUsd,
        units: derived.units,
        unitLabel: derived.unitLabel,
        quotaUsedRatio: derived.quotaUsedRatio,
        asOf: entry.plan.asOf,
        pricingCoverage: derived.pricingCoverage,
      };
    }
    if (entry.meter) {
      return {
        id: entry.id,
        provenance: "derived",
        amountUsd: derived.amountUsd,
        units: derived.units,
        unitLabel: derived.unitLabel,
        quotaUsedRatio: derived.quotaUsedRatio,
        asOf: null,
        pricingCoverage: derived.pricingCoverage,
      };
    }
    return {
      id: entry.id,
      provenance: "unmetered",
      amountUsd: null,
      units: null,
      unitLabel: null,
      quotaUsedRatio: null,
      asOf: null,
      pricingCoverage: null,
    };
  });

  return {
    schemaVersion: 1 as const,
    generatedAt: at.toISOString(),
    cycles: [...resetDays]
      .sort((left, right) => left - right)
      .map((day) => cycleForResetDay(at, day)),
    services,
    totals: {
      declaredMonthlyUsd: registry.reduce(
        (total, entry) => total + (entry.plan.monthlyUsd ?? 0),
        0,
      ),
      derivedCycleUsd,
    },
    coverage: {
      unmeteredServices: services.filter(
        (service) => service.provenance === "unmetered",
      ).length,
      unpricedCalls,
      inFlightCalls: auditSpans.filter(
        (span) => span.kind !== "service" && span.terminal_status === null,
      ).length,
      nonLlmDollarsAvailable: false,
    },
  };
}

async function exactCount(
  request: PromiseLike<{
    count: number | null;
    error: { message: string } | null;
  }>,
): Promise<number> {
  const { count, error } = await request;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function loadSpendSnapshot(
  supabase = createServiceClient(),
  at = new Date(),
): Promise<SpendSnapshotV1> {
  const cycle = cycleForResetDay(at, 1);
  const models = [
    ...new Set([...Object.values(LLM_MODELS), ...DEEPSEEK_MODELS]),
  ];
  const pricedRowsRequest = supabase
    .from("brand_ai_results")
    .select("model, cost_usd, prompt_tokens, completion_tokens")
    .gte("created_at", cycle.start)
    .lt("created_at", cycle.end)
    .in("model", models)
    .not("cost_usd", "is", null);
  const billableCountRequests = models.map(async (model) => [
    model,
    await exactCount(
      supabase
        .from("brand_ai_results")
        .select("id", { count: "exact", head: true })
        .gte("created_at", cycle.start)
        .lt("created_at", cycle.end)
        .eq("model", model)
        .not("raw_response", "is", null)
        .eq("raw_response->>ok", true),
    ),
  ] as const);
  const auditSpansRequest = supabase
    .from("external_call_audit_spans")
    .select("provider, kind, terminal_status")
    .gte("started_at", cycle.start)
    .lt("started_at", cycle.end)
    .in("provider", [...AUDITED_METER_PROVIDERS])
    .neq("kind", "service");

  const [pricedRowsResult, billableEntries, auditSpansResult] =
    await Promise.all([
      pricedRowsRequest,
      Promise.all(billableCountRequests),
      auditSpansRequest,
    ]);
  if (pricedRowsResult.error) throw new Error(pricedRowsResult.error.message);
  if (auditSpansResult.error) throw new Error(auditSpansResult.error.message);

  return buildSpendSnapshot({
    llmRows: (pricedRowsResult.data ?? []) as LlmSpendRow[],
    billableCallsByModel: Object.fromEntries(billableEntries),
    auditSpans: (auditSpansResult.data ?? []) as AuditSpanRow[],
    at,
  });
}

export function createSpendSnapshotCache({
  load = loadSpendSnapshot,
  now = Date.now,
}: {
  load?: () => Promise<SpendSnapshotV1>;
  now?: () => number;
} = {}) {
  let cache: { value: SpendSnapshotV1; expiresAt: number } | null = null;

  async function refresh(): Promise<SpendSnapshotV1> {
    const value = await load();
    cache = { value, expiresAt: now() + CACHE_TTL_MS };
    return value;
  }

  async function get(): Promise<SpendSnapshotV1> {
    if (cache && cache.expiresAt > now()) return cache.value;
    return refresh();
  }

  return { get, refresh };
}

const spendSnapshotCache = createSpendSnapshotCache();

export function getSpendSnapshot(): Promise<SpendSnapshotV1> {
  return spendSnapshotCache.get();
}
