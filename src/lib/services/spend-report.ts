import {
  fetchOpenAICosts,
  type OpenAICosts,
} from "@/lib/adapters/openai/costs";
import { SERVICE_REGISTRY } from "@/lib/services/service-registry";
import {
  buildSpendSnapshot,
  cycleForResetDay,
  loadJevSpend,
  loadSpendWindow,
  type SpendSnapshotV1,
} from "@/lib/services/spend";
import { createServiceClient } from "@/lib/supabase/service";
import {
  buildOperationalAlertSummary,
  loadOperationalSnapshot,
  type OperationalAlertSummary,
} from "@/lib/services/operational-usage";

export type SpendReportV1 = {
  schemaVersion: 1;
  generatedAt: string;
  day: {
    start: string;
    end: string;
    llmUsd: number;
    lines: {
      id: string;
      amountUsd: number | null;
      units: number | null;
      unitLabel: string | null;
    }[];
    unpricedCalls: number;
  };
  cycle: {
    start: string;
    end: string;
    derivedUsd: number;
    declaredMonthlyUsd: number;
  };
  coverage: {
    unmeteredServices: number;
    unpricedCalls: number;
    inFlightCalls: number;
    nonLlmDollarsAvailable: false;
  };
  operations?: OperationalAlertSummary;
  // Optional: a renderer on `main` may read an endpoint that predates these.
  // OpenAI's billed cost (Costs API). Day is the previous complete UTC day,
  // because Costs API buckets are UTC days. Null when unavailable.
  openaiBilled?: {
    dayUsd: number;
    cycleUsd: number;
    dayStart: string;
    dayEnd: string;
  } | null;
  // Derived TypeSafe (Jev) spend from external_call_audit, over the same
  // windows as `day` and `cycle`. Null when the read failed.
  jev?: { dayUsd: number; cycleUsd: number; unpricedCalls: number } | null;
};

export type SpendReportDependencies = {
  fetchOpenAICosts?: (window: {
    startTime: Date;
    endTime: Date;
  }) => Promise<OpenAICosts>;
};

type SpendClient = ReturnType<typeof createServiceClient>;
type SpendWindow = Awaited<ReturnType<typeof loadSpendWindow>>;

// Fixed plan amounts belong in cycle.declaredMonthlyUsd. Report lines show
// only the usage meters, including meters attached to a fixed plan.
const METERED_REPORT_REGISTRY = SERVICE_REGISTRY.filter(
  (entry) => entry.meter !== undefined,
).map((entry) => ({
  ...entry,
  plan: { ...entry.plan, monthlyUsd: undefined },
}));

function buildWindowSnapshot(
  window: SpendWindow,
  at: Date,
  registry = SERVICE_REGISTRY,
): SpendSnapshotV1 {
  return buildSpendSnapshot({ ...window, at, registry });
}

function usageLines(snapshot: SpendSnapshotV1) {
  return snapshot.services.map(({ id, amountUsd, units, unitLabel }) => ({
    id,
    amountUsd,
    units,
    unitLabel,
  }));
}

function llmUsd(snapshot: SpendSnapshotV1): number {
  const llmIds = new Set(
    SERVICE_REGISTRY.filter((entry) => entry.meter === "llm-tokens").map(
      (entry) => entry.id,
    ),
  );
  return snapshot.services.reduce(
    (total, line) => total + (llmIds.has(line.id) ? (line.amountUsd ?? 0) : 0),
    0,
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

function logUnavailable(event: string, error: unknown): void {
  console.error(
    JSON.stringify({
      event,
      error: error instanceof Error ? error.name : "UnknownError",
    }),
  );
}

async function loadOpenAIBilled(
  load: NonNullable<SpendReportDependencies["fetchOpenAICosts"]>,
  at: Date,
  cycleStart: string,
): Promise<SpendReportV1["openaiBilled"]> {
  const dayEnd = new Date(
    Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()),
  );
  const dayStart = new Date(dayEnd.getTime() - DAY_MS);
  const cycleStartMs = Date.parse(cycleStart);
  try {
    // One call covers both windows; on the cycle's first day yesterday
    // precedes the cycle start, so the range widens to include it.
    const costs = await load({
      startTime: new Date(Math.min(cycleStartMs, dayStart.getTime())),
      endTime: at,
    });
    let dayUsd = 0;
    let cycleUsd = 0;
    for (const day of costs.days) {
      const start = Date.parse(day.start);
      if (start === dayStart.getTime()) dayUsd += day.usd;
      if (start >= cycleStartMs) cycleUsd += day.usd;
    }
    return {
      dayUsd,
      cycleUsd,
      dayStart: dayStart.toISOString(),
      dayEnd: dayEnd.toISOString(),
    };
  } catch (error) {
    logUnavailable("spend_report_openai_costs_unavailable", error);
    return null;
  }
}

async function loadJev(
  supabase: SpendClient,
  day: { start: string; end: string },
  cycle: { start: string; end: string },
): Promise<SpendReportV1["jev"]> {
  try {
    const [daySpend, cycleSpend] = await Promise.all([
      loadJevSpend(supabase, day.start, day.end),
      loadJevSpend(supabase, cycle.start, cycle.end),
    ]);
    return {
      dayUsd: daySpend.usd,
      cycleUsd: cycleSpend.usd,
      unpricedCalls: daySpend.unpricedCalls,
    };
  } catch (error) {
    logUnavailable("spend_report_jev_unavailable", error);
    return null;
  }
}

export async function loadSpendReport(
  supabase: SpendClient = createServiceClient(),
  at = new Date(),
  dependencies: SpendReportDependencies = {},
): Promise<SpendReportV1> {
  const generatedAt = at.toISOString();
  const dayStart = new Date(at.getTime() - DAY_MS).toISOString();
  const cycle = cycleForResetDay(at, 1);
  const [dayWindow, cycleWindow, openaiBilled, jev] = await Promise.all([
    loadSpendWindow(supabase, dayStart, generatedAt),
    loadSpendWindow(supabase, cycle.start, cycle.end),
    loadOpenAIBilled(
      dependencies.fetchOpenAICosts ?? ((window) => fetchOpenAICosts(window)),
      at,
      cycle.start,
    ),
    loadJev(supabase, { start: dayStart, end: generatedAt }, cycle),
  ]);

  const daySnapshot = buildWindowSnapshot(dayWindow, at);
  const dayUsageSnapshot = buildWindowSnapshot(
    dayWindow,
    at,
    METERED_REPORT_REGISTRY,
  );
  const cycleSnapshot = buildWindowSnapshot(cycleWindow, at);
  let operations: OperationalAlertSummary;
  try {
    operations = buildOperationalAlertSummary(
      await loadOperationalSnapshot({
        now: at,
        supabase,
        spend: Promise.resolve(cycleSnapshot),
        openaiBilledCycleUsd: Promise.resolve(openaiBilled?.cycleUsd ?? null),
      }),
    );
  } catch {
    operations = {
      needsAttention: true,
      unavailableUpstash: true,
      warnings: [],
      lowerBoundCaveats: [],
      openai: null,
      upstash: {
        state: "error",
        risk: "unknown",
        value: null,
        limit: null,
        percentage: null,
        projection: null,
        message: "Upstash monitoring failed.",
        window: null,
        subject: null,
      },
      posthog: null,
      sentry: null,
      resend: null,
      langfuse: null,
      github: null,
    };
  }

  return {
    schemaVersion: 1 as const,
    generatedAt,
    day: {
      start: dayStart,
      end: generatedAt,
      llmUsd: llmUsd(dayUsageSnapshot),
      lines: usageLines(dayUsageSnapshot),
      unpricedCalls: daySnapshot.coverage.unpricedCalls,
    },
    cycle: {
      start: cycle.start,
      end: cycle.end,
      derivedUsd: cycleSnapshot.totals.derivedCycleUsd,
      declaredMonthlyUsd: cycleSnapshot.totals.declaredMonthlyUsd,
    },
    coverage: {
      unmeteredServices: cycleSnapshot.coverage.unmeteredServices,
      unpricedCalls: cycleSnapshot.coverage.unpricedCalls,
      inFlightCalls: cycleSnapshot.coverage.inFlightCalls,
      nonLlmDollarsAvailable: false,
    },
    operations,
    openaiBilled,
    jev,
  };
}
