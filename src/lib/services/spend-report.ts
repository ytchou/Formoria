import { SERVICE_REGISTRY } from "@/lib/services/service-registry";
import {
  buildSpendSnapshot,
  cycleForResetDay,
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

export async function loadSpendReport(
  supabase: SpendClient = createServiceClient(),
  at = new Date(),
): Promise<SpendReportV1> {
  const generatedAt = at.toISOString();
  const dayStart = new Date(at.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const cycle = cycleForResetDay(at, 1);
  const [dayWindow, cycleWindow] = await Promise.all([
    loadSpendWindow(supabase, dayStart, generatedAt),
    loadSpendWindow(supabase, cycle.start, cycle.end),
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
      }),
    );
  } catch {
    operations = {
      needsAttention: true,
      unavailableUpstash: true,
      // The snapshot never loaded, so the egress alarm is dark too.
      unavailableRailway: true,
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
      railway: null,
      railwayMemory: null,
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
  };
}
