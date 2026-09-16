import {
  BLOCK_ORDER,
  CURATION_TASKS,
  ENRICH_PHASES,
  ENRICH_LLM_PHASES,
  forcePhasesForRetry,
  isDeferredPhase,
  normalizeRequestedPhases,
  parseLegacyStepsToPhases,
  phasesForTask,
  type CurationTask,
  type EnrichPhaseName,
  type RetryParams,
} from "@/lib/constants/enrich-phases";

export type TargetPlan = {
  selected: EnrichPhaseName[];
  forced: EnrichPhaseName[];
  explicit: EnrichPhaseName[];
};

export type RecoveryPlan = {
  version: 1;
  action: { kind: "rerun" | "resume" } | ({ kind: "phase" } & RetryParams);
  targets: Record<string, TargetPlan>;
};

type RecoveryTarget = {
  id: string;
  status: string;
  results: readonly { phase: string; status: string }[];
  /** Successful, usable, unmerged checkpoints from the source scope only. */
  reusablePhases: readonly EnrichPhaseName[];
};

export function buildRecoveryPlan(
  sourceParams: unknown,
  action: RecoveryPlan["action"],
  targets: readonly RecoveryTarget[],
): RecoveryPlan {
  if (new Set(targets.map((target) => target.id)).size !== targets.length) {
    throw new Error("Duplicate recovery target");
  }
  const plans = targets.map((target): [string, TargetPlan] => {
    const source = readTargetPlan(sourceParams, target.id);
    if (action.kind === "phase") {
      const selected = forcePhasesForRetry(legacyRetry(action));
      return [
        target.id,
        { selected, forced: [...selected], explicit: [...selected] },
      ];
    }
    if (action.kind === "rerun" || target.status === "cancelled") {
      return [target.id, { ...source, forced: [...source.selected] }];
    }
    if (target.status !== "failed") {
      throw new Error("Resume requires failed or cancelled targets");
    }
    const reusable = new Set(
      target.reusablePhases.filter((phase) => source.selected.includes(phase)),
    );
    if (reusable.size) {
      return [
        target.id,
        {
          ...source,
          forced: source.selected.filter((phase) => !reusable.has(phase)),
        },
      ];
    }
    // Historical jobs have phase results but no usable checkpoints.
    const recorded = new Map(
      target.results.map((result) => [result.phase, result.status]),
    );
    const unfinished = source.selected.filter(
      (phase) => !recorded.has(phase) || recorded.get(phase) === "failed",
    );
    const fallback = source.selected.filter((phase) =>
      (ENRICH_LLM_PHASES as readonly string[]).includes(phase),
    );
    const selected = unfinished.length
      ? unfinished
      : fallback.length
        ? fallback
        : source.selected;
    return [
      target.id,
      {
        selected,
        forced: [...selected],
        explicit: source.explicit.filter((phase) => selected.includes(phase)),
      },
    ];
  });
  return validateRecoveryPlan({
    version: 1,
    action,
    targets: Object.fromEntries(plans),
  });
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid recovery plan: expected an object");
  }
  return value as Record<string, unknown>;
}

function phaseList(value: unknown): EnrichPhaseName[] {
  if (
    !Array.isArray(value) ||
    value.some(
      (phase) =>
        typeof phase !== "string" ||
        !(ENRICH_PHASES as readonly string[]).includes(phase) ||
        isDeferredPhase(phase),
    )
  )
    throw new Error("Invalid recovery phase scope");
  return ENRICH_PHASES.filter((phase) => value.includes(phase));
}

function legacyRetry(value: unknown): RetryParams {
  const retry = object(value);
  if (
    !(BLOCK_ORDER as readonly unknown[]).includes(retry.block) ||
    (retry.mode !== "only" && retry.mode !== "with_upstream") ||
    (retry.subPhase !== undefined &&
      (retry.block !== "editorial" ||
        !["descriptions", "stockists", "faq"].includes(String(retry.subPhase))))
  )
    throw new Error("Invalid recovery retry selection");
  const selected = retry as RetryParams;
  if (!forcePhasesForRetry(selected).length) {
    throw new Error("Invalid recovery retry: no executable phases");
  }
  return selected;
}

export function validateRecoveryPlan(value: unknown): RecoveryPlan {
  const plan = object(value);
  if (plan.version !== 1) throw new Error("Unsupported recovery plan version");
  const metadata = object(plan.action);
  let action: RecoveryPlan["action"];
  if (metadata.kind === "phase") {
    action = { ...legacyRetry(metadata), kind: "phase" };
  } else if (metadata.kind === "rerun" || metadata.kind === "resume") {
    action = { kind: metadata.kind };
  } else throw new Error("Invalid recovery action");
  const targets = Object.entries(object(plan.targets));
  if (!targets.length) throw new Error("Recovery plan has no targets");
  return {
    version: 1,
    action,
    targets: Object.fromEntries(
      targets.map(([id, value]) => {
        if (!id.trim()) throw new Error("Invalid recovery target ID");
        const target = object(value);
        const selected = phaseList(target.selected);
        const forced = phaseList(target.forced);
        const explicit = phaseList(target.explicit);
        if (!selected.length)
          throw new Error("Recovery target has no selected phases");
        if (
          [...forced, ...explicit].some((phase) => !selected.includes(phase))
        ) {
          throw new Error(
            "Recovery forced and explicit phases must be selected",
          );
        }
        return [id, { selected, forced, explicit }];
      }),
    ),
  };
}

/** Historical parameters are normalized here; stored rows are never rewritten. */
export function readTargetPlan(
  paramsValue: unknown,
  targetId: string,
): TargetPlan {
  const params = paramsValue == null ? {} : object(paramsValue);
  if (Object.hasOwn(params, "retry")) {
    const retry = object(params.retry);
    if (Object.hasOwn(retry, "version")) {
      const plan = validateRecoveryPlan(retry);
      const target = Object.hasOwn(plan.targets, targetId)
        ? plan.targets[targetId]
        : undefined;
      if (!target)
        throw new Error(`Recovery plan is missing target ${targetId}`);
      return target;
    }
    const selected = forcePhasesForRetry(legacyRetry(retry));
    return { selected, forced: [...selected], explicit: [...selected] };
  }
  let selected: EnrichPhaseName[];
  let explicit: EnrichPhaseName[] = [];
  if (Object.hasOwn(params, "phases")) {
    if (
      !Array.isArray(params.phases) ||
      params.phases.some((p) => typeof p !== "string")
    ) {
      throw new Error("Invalid historical phase scope");
    }
    selected = normalizeRequestedPhases(
      params.phases.filter((p) => p !== "expansion" && p !== "reputation"),
    );
    explicit = [...selected];
  } else if (
    typeof params.task === "string" &&
    Object.hasOwn(CURATION_TASKS, params.task)
  ) {
    selected = phasesForTask(params.task as CurationTask);
  } else if (Array.isArray(params.steps) && params.steps.length) {
    selected = parseLegacyStepsToPhases(params.steps) ?? [];
  } else {
    selected = phasesForTask("full");
  }
  if (!selected.length)
    throw new Error("Historical job has no executable phase scope");
  return { selected, forced: [], explicit };
}
