import {
  requiresHumanPolicy,
  type HealthFinding,
  type HealthSource,
  type JsonValue,
  type MergePolicy,
} from "./contracts";

export const MAX_REPAIR_CYCLES = 2 as const;
export const AUTOMATIC_CONFIDENCE_THRESHOLD = 0.8 as const;

export type RepairBatchKind = "automatic" | "human";
export type RepairCycleNumber = 1 | 2;
export type ValidationState = "not_run" | "passed" | "failed";
export type ReviewState = "not_run" | "passed" | "failed";
export type RepairCombinedState =
  "not_run" | "incomplete" | "passed" | "failed";
export type RepairConfidence = number | "low" | "medium" | "high";
export type RepairBehaviorRisk = "low" | "medium" | "high" | "unknown";
export type RepairDefectKind = "application" | "dependency" | "unknown";
export type DependencyImpact = "patch" | "minor" | "major" | "unknown";
export type RepairFindingStatus =
  | "pending"
  | "retry_required"
  | "ready_to_merge"
  | "awaiting_human"
  | "needs_human"
  | "merged";

export type ChangedFileMapping =
  readonly string[] | Readonly<Record<string, readonly string[]>>;

/**
 * A repair finding is deliberately separate from HealthFinding. The health
 * collectors remain provider-neutral, while this type carries the evidence
 * needed to make and audit a repair decision.
 */
export interface RepairFinding extends HealthFinding {
  rootCauseKey?: string;
  evidenceArtifactRef?: string;
  changedFiles?: readonly string[];
  changedFileMapping?: ChangedFileMapping;
  confidence?: RepairConfidence;
  reproducible?: boolean;
  behaviorChangeRisk?: RepairBehaviorRisk;
  behaviorRisk?: RepairBehaviorRisk;
  sensitivePaths?: readonly string[];
  defectKind?: RepairDefectKind;
  dependencyImpact?: DependencyImpact;
  fixability?: "low" | "medium" | "high" | "unknown";
  validationRequired?: boolean;
  validationWeakening?: boolean;
  changesMergePolicy?: boolean;
  claimedFindingId?: string;
}

export type RepairPolicyReasonCode =
  | "requested_human"
  | "critical_severity"
  | "confidence_below_threshold"
  | "not_reproducible"
  | "behavior_risk_not_low"
  | "sensitive_path"
  | "validation_weakening"
  | "merge_policy_change"
  | "unsupported_defect_kind"
  | "dependency_impact_requires_human"
  | "missing_evidence_artifact"
  | "missing_changed_files"
  | "fixability_not_high";

export interface RepairPolicyDecision {
  fingerprint: string;
  rootCauseKey: string;
  mergePolicy: MergePolicy;
  automaticEligible: boolean;
  reasons: readonly RepairPolicyReasonCode[];
  sensitivePaths: readonly string[];
  defectKind: RepairDefectKind;
  dependencyImpact: DependencyImpact | null;
}

export interface RepairFindingTraceability {
  fingerprint: string;
  source: HealthSource;
  evidenceArtifactRef: string | null;
  changedFiles: readonly string[];
}

export interface RepairCluster {
  rootCauseKey: string;
  findings: readonly RepairFinding[];
  fingerprints: readonly string[];
  sources: readonly HealthSource[];
  evidenceArtifactRefs: readonly (string | null)[];
  changedFileMapping: Readonly<Record<string, readonly string[]>>;
  traceability: readonly RepairFindingTraceability[];
}

export interface RepairSnapshot {
  snapshotId: string;
  findings: readonly RepairFinding[];
}

export interface RepairBatchFindingPolicy {
  fingerprint: string;
  rootCauseKey: string;
  requestedMergePolicy: MergePolicy;
  effectiveMergePolicy: MergePolicy;
  automaticEligible: boolean;
  reasons: readonly RepairPolicyReasonCode[];
}

export interface RepairBatch {
  batchKind: RepairBatchKind;
  mergePolicy: MergePolicy;
  snapshotId: string;
  branchName: string;
  clusters: readonly RepairCluster[];
  findings: readonly RepairFinding[];
  findingPolicies: readonly RepairBatchFindingPolicy[];
}

export interface RepairPartition {
  snapshot: RepairSnapshot;
  automatic: RepairBatch;
  human: RepairBatch;
}

export interface RepairFindingCycleState {
  fingerprint: string;
  validationState: ValidationState;
  reviewState: ReviewState;
}

export interface RepairCycleReport {
  cycle: RepairCycleNumber;
  validationState: ValidationState;
  reviewState: ReviewState;
  findingStates?: readonly RepairFindingCycleState[];
}

export interface RepairCycleResult {
  cycle: RepairCycleNumber;
  validationState: ValidationState;
  reviewState: ReviewState;
  combinedState: RepairCombinedState;
  findingStates: readonly RepairFindingCycleState[];
}

export interface RepairFindingResult {
  fingerprint: string;
  source: HealthSource;
  title: string;
  rootCauseKey: string;
  evidenceArtifactRef: string | null;
  changedFiles: readonly string[];
  requestedMergePolicy: MergePolicy;
  mergePolicy: MergePolicy;
  validationState: ValidationState;
  reviewState: ReviewState;
  status: RepairFindingStatus;
  autoMergeEligible: boolean;
}

export interface RepairEvaluationOptions {
  autoMergeEnabled?: boolean;
  merged?: boolean;
}

export interface RepairResult {
  batchKind: RepairBatchKind;
  mergePolicy: MergePolicy;
  snapshotId: string;
  branchName: string;
  status: RepairFindingStatus;
  cycles: readonly RepairCycleResult[];
  findings: readonly RepairFindingResult[];
  validationState: ValidationState;
  reviewState: ReviewState;
  linearRequired: boolean;
  autoMergeEnabled: boolean;
  autoMergeEligible: boolean;
  fixed: boolean;
  merged: boolean;
  escalationReason?:
    "second_cycle_failed" | "second_cycle_incomplete" | "first_cycle_failed";
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function nonemptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function valueFromEvidence(
  finding: RepairFinding,
  keys: readonly string[],
): unknown {
  const evidence = finding.evidence as UnknownRecord;
  const classification = isRecord(evidence.classification)
    ? evidence.classification
    : null;

  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(evidence, key))
      return evidence[key];
    if (
      classification &&
      Object.prototype.hasOwnProperty.call(classification, key)
    )
      return classification[key];
  }
  return undefined;
}

function stringFromEvidence(
  finding: RepairFinding,
  keys: readonly string[],
): string | null {
  return nonemptyString(valueFromEvidence(finding, keys));
}

function booleanFromEvidence(
  finding: RepairFinding,
  keys: readonly string[],
): boolean | null {
  const value = valueFromEvidence(finding, keys);
  return typeof value === "boolean" ? value : null;
}

function confidenceScore(value: RepairConfidence | null): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value === "high") return 1;
  if (value === "medium") return 0.5;
  if (value === "low") return 0;
  return null;
}

function confidenceOf(finding: RepairFinding): number | null {
  const direct = finding.confidence;
  if (direct !== undefined) return confidenceScore(direct);

  const evidenceValue = valueFromEvidence(finding, ["confidence"]);
  if (
    typeof evidenceValue === "number" ||
    evidenceValue === "low" ||
    evidenceValue === "medium" ||
    evidenceValue === "high"
  ) {
    return confidenceScore(evidenceValue);
  }
  return null;
}

function behaviorRiskOf(finding: RepairFinding): RepairBehaviorRisk | null {
  const direct = finding.behaviorChangeRisk ?? finding.behaviorRisk;
  if (direct) return direct;
  const evidenceValue = stringFromEvidence(finding, [
    "behaviorChangeRisk",
    "behaviorRisk",
  ]);
  return evidenceValue === "low" ||
    evidenceValue === "medium" ||
    evidenceValue === "high" ||
    evidenceValue === "unknown"
    ? evidenceValue
    : null;
}

function dependencyImpactOf(finding: RepairFinding): DependencyImpact | null {
  const direct = finding.dependencyImpact;
  if (direct) return direct;
  const evidenceValue = stringFromEvidence(finding, [
    "dependencyImpact",
    "versionImpact",
  ]);
  return evidenceValue === "patch" ||
    evidenceValue === "minor" ||
    evidenceValue === "major" ||
    evidenceValue === "unknown"
    ? evidenceValue
    : null;
}

function defectKindOf(
  finding: RepairFinding,
  dependencyImpact: DependencyImpact | null,
): RepairDefectKind {
  if (finding.defectKind) return finding.defectKind;
  if (dependencyImpact) return "dependency";

  const evidenceKind = stringFromEvidence(finding, [
    "defectKind",
    "defectType",
    "category",
  ]);
  if (evidenceKind === "application" || evidenceKind === "dependency")
    return evidenceKind;

  const rootCause = stringFromEvidence(finding, ["rootCause", "root_cause"]);
  const scope = `${finding.title} ${rootCause ?? ""}`;
  if (
    /\b(?:infrastructure|network|third[- ]party|vendor|dependency|configuration|config(?:uration)?|credential|authentication|authorization|permission|database|migration|schema|data loss|privacy|security|deployment|secret|token)\b/i.test(
      scope,
    )
  ) {
    return "unknown";
  }
  return "application";
}

function rawChangedFileMapping(finding: RepairFinding): readonly string[] {
  const files: string[] = [];
  if (finding.changedFiles) files.push(...finding.changedFiles);

  const mapping = finding.changedFileMapping;
  if (Array.isArray(mapping)) {
    files.push(...mapping);
  } else if (mapping) {
    for (const values of Object.values(mapping)) files.push(...values);
  }

  const evidenceValue = valueFromEvidence(finding, [
    "changedFiles",
    "changed_files",
  ]);
  if (Array.isArray(evidenceValue)) {
    for (const value of evidenceValue) {
      const path = nonemptyString(value);
      if (path) files.push(path);
    }
  }

  return [...new Set(files.map((file) => file.trim()).filter(Boolean))].sort(
    compareText,
  );
}

function artifactReferenceOf(finding: RepairFinding): string | null {
  return (
    nonemptyString(finding.evidenceArtifactRef) ??
    stringFromEvidence(finding, [
      "evidenceArtifactRef",
      "evidence_artifact_ref",
      "artifactPath",
      "artifact_path",
      "sanitizedEvidencePath",
      "sanitized_evidence_path",
    ])
  );
}

function rootCauseCandidateOf(finding: RepairFinding): string | null {
  return (
    nonemptyString(finding.rootCauseKey) ??
    stringFromEvidence(finding, [
      "rootCauseKey",
      "root_cause_key",
      "sharedRootCauseKey",
      "shared_root_cause_key",
    ])
  );
}

function slug(value: string, maxLength = 80): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (normalized || "unknown").slice(0, maxLength).replace(/-+$/g, "");
}

function rootCauseKeyOf(finding: RepairFinding): string {
  const candidate = rootCauseCandidateOf(finding);
  if (candidate) return slug(candidate);
  const rootCause = stringFromEvidence(finding, ["rootCause", "root_cause"]);
  if (rootCause) return slug(rootCause);
  return `fingerprint-${slug(finding.fingerprint)}`;
}

function normalizePath(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
}

function pathIsSensitive(path: string): boolean {
  const normalized = normalizePath(path);
  return (
    /(?:^|\/)\.github(?:\/|$)/.test(normalized) ||
    /(?:^|\/)\.github\/workflows?(?:\/|$)/.test(normalized) ||
    /(?:^|\/)(?:workflow|workflows)(?:\/|[._-]|$)/.test(normalized) ||
    /(?:^|\/)[^/]*(?:prompt|prompts)(?:[._/-]|$)/.test(normalized) ||
    /(?:^|\/)(?:auth|authentication|oauth|identity|session|login)(?:\/|[._-]|$)/.test(
      normalized,
    ) ||
    /(?:^|\/)(?:permission|permissions|rbac|acl|roles?)(?:\/|[._-]|$)/.test(
      normalized,
    ) ||
    /(?:^|\/)(?:security|secret|secrets|credential|credentials)(?:\/|[._-]|$)/.test(
      normalized,
    ) ||
    /(?:^|\/)(?:migration|migrations|schema)(?:\/|[._-]|$)/.test(normalized) ||
    /merge[-_]?policy|branch[-_]?protection|required[-_]?checks/.test(
      normalized,
    ) ||
    /(?:^|\/)(?:validation|validator)(?:\/|[._-]|$)/.test(normalized)
  );
}

function validationWeakeningOf(finding: RepairFinding): boolean {
  if (finding.validationWeakening === true) return true;
  const scope = `${finding.title} ${stringFromEvidence(finding, ["rootCause", "root_cause"]) ?? ""}`;
  return /(?:weak(?:en|ening|ened)|bypass|skip|disable).{0,40}validat|validat.{0,40}(?:weak(?:en|ening|ened)|bypass|skip|disable)/i.test(
    scope,
  );
}

function sensitivePathsOf(finding: RepairFinding): readonly string[] {
  const paths: string[] = [];
  if (finding.sensitivePaths) paths.push(...finding.sensitivePaths);
  const evidenceValue = valueFromEvidence(finding, [
    "sensitivePaths",
    "sensitive_paths",
  ]);
  if (Array.isArray(evidenceValue)) {
    for (const value of evidenceValue) {
      const path = nonemptyString(value);
      if (path) paths.push(path);
    }
  }
  for (const path of rawChangedFileMapping(finding)) {
    if (pathIsSensitive(path)) paths.push(path);
  }
  return [...new Set(paths.map((path) => path.trim()).filter(Boolean))].sort(
    compareText,
  );
}

function likelyHumanDueToScope(finding: RepairFinding): boolean {
  const scope = `${finding.title} ${stringFromEvidence(finding, ["rootCause", "root_cause"]) ?? ""}`;
  return /(?:merge\s*policy|validation\s*(?:weak|bypass|skip|disable)|permission|workflow|migration)/i.test(
    scope,
  );
}

export function decideRepairPolicy(
  finding: RepairFinding,
): RepairPolicyDecision {
  const reasons: RepairPolicyReasonCode[] = [];
  const dependencyImpact = dependencyImpactOf(finding);
  const defectKind = defectKindOf(finding, dependencyImpact);
  const changedFiles = rawChangedFileMapping(finding);
  const sensitivePaths = sensitivePathsOf(finding);

  if (requiresHumanPolicy(finding)) reasons.push("requested_human");
  if (finding.severity === "critical" && defectKind !== "dependency")
    reasons.push("critical_severity");
  if (sensitivePaths.length > 0) reasons.push("sensitive_path");
  if (finding.changesMergePolicy === true || likelyHumanDueToScope(finding))
    reasons.push("merge_policy_change");
  if (validationWeakeningOf(finding)) reasons.push("validation_weakening");
  if (!artifactReferenceOf(finding)) reasons.push("missing_evidence_artifact");
  if (changedFiles.length === 0) reasons.push("missing_changed_files");
  if (dependencyImpact === "major" || dependencyImpact === "unknown")
    reasons.push("dependency_impact_requires_human");

  if (defectKind === "unknown") {
    reasons.push("unsupported_defect_kind");
  } else if (defectKind === "dependency") {
    if (dependencyImpact !== "patch" && dependencyImpact !== "minor") {
      reasons.push("dependency_impact_requires_human");
    }
    const behaviorRisk = behaviorRiskOf(finding);
    if (behaviorRisk !== null && behaviorRisk !== "low")
      reasons.push("behavior_risk_not_low");
  } else {
    const confidence = confidenceOf(finding);
    if (
      confidence === null ||
      confidence < AUTOMATIC_CONFIDENCE_THRESHOLD ||
      confidence > 1
    )
      reasons.push("confidence_below_threshold");

    const reproducible =
      finding.reproducible ?? booleanFromEvidence(finding, ["reproducible"]);
    if (reproducible !== true) reasons.push("not_reproducible");

    const behaviorRisk = behaviorRiskOf(finding);
    if (behaviorRisk !== "low") reasons.push("behavior_risk_not_low");

    const fixability =
      finding.fixability ?? stringFromEvidence(finding, ["fixability"]);
    if (
      fixability !== null &&
      fixability !== undefined &&
      fixability !== "high"
    )
      reasons.push("fixability_not_high");
  }

  const uniqueReasons = [...new Set(reasons)];
  return {
    automaticEligible: uniqueReasons.length === 0,
    dependencyImpact,
    defectKind,
    fingerprint: finding.fingerprint,
    mergePolicy: uniqueReasons.length === 0 ? "automatic" : "human",
    reasons: uniqueReasons,
    rootCauseKey: rootCauseKeyOf(finding),
    sensitivePaths,
  };
}

function cloneJsonValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(cloneJsonValue);
  if (isRecord(value)) {
    const clone: Record<string, JsonValue> = {};
    for (const [key, nested] of Object.entries(value)) {
      if (nested === undefined) continue;
      clone[key] = cloneJsonValue(nested as JsonValue);
    }
    return clone;
  }
  return value;
}

function cloneFinding(finding: RepairFinding): RepairFinding {
  const changedFileMapping = finding.changedFileMapping;
  const clonedMapping: ChangedFileMapping | undefined = Array.isArray(
    changedFileMapping,
  )
    ? [...changedFileMapping]
    : changedFileMapping
      ? Object.fromEntries(
          Object.entries(changedFileMapping).map(([key, values]) => [
            key,
            [...values],
          ]),
        )
      : undefined;

  return {
    ...finding,
    ...(finding.changedFiles
      ? { changedFiles: [...finding.changedFiles] }
      : {}),
    ...(clonedMapping ? { changedFileMapping: clonedMapping } : {}),
    ...(finding.sensitivePaths
      ? { sensitivePaths: [...finding.sensitivePaths] }
      : {}),
    evidence: cloneJsonValue(finding.evidence) as Record<string, JsonValue>,
  };
}

function stableSerialize(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean")
    return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort(compareText)
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(String(value));
}

function stableHash(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    hash ^= code;
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function sortedFindings(findings: readonly RepairFinding[]): RepairFinding[] {
  return [...findings].sort(
    (left, right) =>
      compareText(left.fingerprint, right.fingerprint) ||
      compareText(rootCauseKeyOf(left), rootCauseKeyOf(right)),
  );
}

export function snapshotClaimedFindings(
  findings: readonly RepairFinding[],
): RepairSnapshot {
  for (const finding of findings) {
    if (!nonemptyString(finding.fingerprint))
      throw new Error("A claimed repair finding must have a fingerprint");
  }

  const clonedFindings = sortedFindings(findings).map(cloneFinding);
  const snapshotId = `snapshot-${stableHash(stableSerialize(clonedFindings))}`;
  return { findings: clonedFindings, snapshotId };
}

function isRepairSnapshot(
  input: RepairSnapshot | readonly RepairFinding[],
): input is RepairSnapshot {
  return !Array.isArray(input) && isRecord(input) && "snapshotId" in input;
}

function findingFromSnapshotOrInput(
  input: RepairSnapshot | readonly RepairFinding[],
): readonly RepairFinding[] {
  return isRepairSnapshot(input) ? input.findings : input;
}

export function clusterRepairFindings(
  input: RepairSnapshot | readonly RepairFinding[],
): readonly RepairCluster[] {
  const grouped = new Map<string, RepairFinding[]>();
  for (const finding of sortedFindings(findingFromSnapshotOrInput(input))) {
    const key = rootCauseKeyOf(finding);
    const existing = grouped.get(key);
    if (existing) existing.push(finding);
    else grouped.set(key, [finding]);
  }

  return [...grouped.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([rootCauseKey, findings]) => {
      const traceability = findings.map((finding) => ({
        changedFiles: rawChangedFileMapping(finding),
        evidenceArtifactRef: artifactReferenceOf(finding),
        fingerprint: finding.fingerprint,
        source: finding.source,
      }));
      const changedFileMapping: Record<string, readonly string[]> = {};
      for (const trace of traceability)
        changedFileMapping[trace.fingerprint] = trace.changedFiles;

      return {
        changedFileMapping,
        evidenceArtifactRefs: traceability.map(
          ({ evidenceArtifactRef }) => evidenceArtifactRef,
        ),
        findings,
        fingerprints: traceability.map(({ fingerprint }) => fingerprint),
        rootCauseKey,
        sources: traceability.map(({ source }) => source),
        traceability,
      };
    });
}

function branchNameFor(kind: RepairBatchKind, snapshotId: string): string {
  return `health/repair/${kind}/${snapshotId.replace(/^snapshot-/, "")}`;
}

export function buildRepairBranchName(
  batch: Pick<RepairBatch, "batchKind" | "snapshotId">,
): string {
  return branchNameFor(batch.batchKind, batch.snapshotId);
}

function createBatch(
  snapshot: RepairSnapshot,
  batchKind: RepairBatchKind,
  clusters: readonly RepairCluster[],
): RepairBatch {
  const findings = clusters.flatMap(
    ({ findings: clusterFindings }) => clusterFindings,
  );
  const findingPolicies = findings.map((finding) => {
    const decision = decideRepairPolicy(finding);
    return {
      automaticEligible: decision.automaticEligible,
      effectiveMergePolicy: batchKind,
      fingerprint: finding.fingerprint,
      reasons: decision.reasons,
      requestedMergePolicy: finding.mergePolicy,
      rootCauseKey: decision.rootCauseKey,
    };
  });

  return {
    batchKind,
    branchName: branchNameFor(batchKind, snapshot.snapshotId),
    clusters,
    findingPolicies,
    findings,
    mergePolicy: batchKind,
    snapshotId: snapshot.snapshotId,
  };
}

export function partitionRepairBatch(
  input: RepairSnapshot | readonly RepairFinding[],
): RepairPartition {
  const snapshot = isRepairSnapshot(input)
    ? input
    : snapshotClaimedFindings(input);
  const clusters = clusterRepairFindings(snapshot);
  const automaticClusters: RepairCluster[] = [];
  const humanClusters: RepairCluster[] = [];

  for (const cluster of clusters) {
    const clusterIsAutomatic = cluster.findings.every(
      (finding) => decideRepairPolicy(finding).automaticEligible,
    );
    if (clusterIsAutomatic) automaticClusters.push(cluster);
    else humanClusters.push(cluster);
  }

  return {
    automatic: createBatch(snapshot, "automatic", automaticClusters),
    human: createBatch(snapshot, "human", humanClusters),
    snapshot,
  };
}

function stateForFinding(
  report: RepairCycleReport,
  finding: RepairFinding,
): RepairFindingCycleState {
  const explicit = report.findingStates?.find(
    ({ fingerprint }) => fingerprint === finding.fingerprint,
  );
  return (
    explicit ?? {
      fingerprint: finding.fingerprint,
      reviewState: report.reviewState,
      validationState: report.validationState,
    }
  );
}

function combinedStateFor(
  validationState: ValidationState,
  reviewState: ReviewState,
): RepairCombinedState {
  if (validationState === "failed" || reviewState === "failed") return "failed";
  if (validationState === "passed" && reviewState === "passed") return "passed";
  if (validationState === "not_run" && reviewState === "not_run")
    return "not_run";
  return "incomplete";
}

function aggregateState(
  states: readonly RepairFindingCycleState[],
  property: "validationState" | "reviewState",
): ValidationState | ReviewState {
  if (states.some((state) => state[property] === "failed")) return "failed";
  if (
    states.length > 0 &&
    states.every((state) => state[property] === "passed")
  )
    return "passed";
  return "not_run";
}

function cycleResultFor(
  batch: RepairBatch,
  report: RepairCycleReport,
): RepairCycleResult {
  const expected = new Set(
    batch.findings.map(({ fingerprint }) => fingerprint),
  );
  const findingStates = batch.findings.map((finding) =>
    stateForFinding(report, finding),
  );
  const supplied = report.findingStates ?? [];
  if (report.findingStates && supplied.length !== batch.findings.length)
    throw new Error(
      "Cycle finding traceability must cover the repair snapshot",
    );
  for (const state of supplied) {
    if (!expected.has(state.fingerprint))
      throw new Error("Cycle finding is outside the repair snapshot");
  }
  if (
    new Set(supplied.map(({ fingerprint }) => fingerprint)).size !==
    supplied.length
  )
    throw new Error(
      "Cycle finding traceability contains a duplicate fingerprint",
    );

  const validationState = aggregateState(findingStates, "validationState");
  const reviewState = aggregateState(findingStates, "reviewState");
  return {
    combinedState: combinedStateFor(validationState, reviewState),
    cycle: report.cycle,
    findingStates,
    reviewState,
    validationState,
  };
}

function latestStateForFinding(
  cycles: readonly RepairCycleResult[],
  finding: RepairFinding,
): RepairFindingCycleState {
  const latest = cycles.at(-1);
  const explicit = latest?.findingStates.find(
    ({ fingerprint }) => fingerprint === finding.fingerprint,
  );
  return (
    explicit ?? {
      fingerprint: finding.fingerprint,
      reviewState: "not_run",
      validationState: "not_run",
    }
  );
}

export function evaluateRepairCycles(
  batch: RepairBatch,
  reports: readonly RepairCycleReport[],
  options: RepairEvaluationOptions = {},
): RepairResult {
  if (reports.length > MAX_REPAIR_CYCLES)
    throw new Error("A repair may have at most two fix/review cycles");

  const seenCycles = new Set<number>();
  for (const report of reports) {
    if (seenCycles.has(report.cycle))
      throw new Error("A repair cycle may only be reported once");
    seenCycles.add(report.cycle);
  }
  if (seenCycles.has(2) && !seenCycles.has(1))
    throw new Error("The second repair cycle requires the first cycle");

  const cycles = [...reports]
    .sort((left, right) => left.cycle - right.cycle)
    .map((report) => cycleResultFor(batch, report));
  const latest = cycles.at(-1);
  const validationState = latest?.validationState ?? "not_run";
  const reviewState = latest?.reviewState ?? "not_run";
  const combinedPassed = latest?.combinedState === "passed";
  const secondCycle = latest?.cycle === 2;
  const secondCycleFailed = secondCycle && latest.combinedState === "failed";
  const secondCycleIncomplete =
    secondCycle && latest.combinedState === "incomplete";
  const exhaustedWithoutPass = secondCycle && latest.combinedState !== "passed";
  const fixed = combinedPassed && !exhaustedWithoutPass;

  let status: RepairFindingStatus;
  if (secondCycleFailed || secondCycleIncomplete) status = "needs_human";
  else if (!latest) status = "pending";
  else if (!fixed) status = "retry_required";
  else if (batch.batchKind === "human") status = "awaiting_human";
  else status = "ready_to_merge";

  const linearRequired =
    batch.batchKind === "human" || status === "needs_human";
  const autoMergeEnabled =
    batch.batchKind === "automatic" &&
    (options.autoMergeEnabled ?? true) &&
    status !== "needs_human";
  const autoMergeEligible = autoMergeEnabled && fixed;
  const merged = Boolean(
    options.merged &&
    fixed &&
    (autoMergeEligible || batch.batchKind === "human"),
  );
  if (merged) status = "merged";

  const findings = batch.findings.map((finding) => {
    const state = latestStateForFinding(cycles, finding);
    return {
      autoMergeEligible:
        autoMergeEligible &&
        state.validationState === "passed" &&
        state.reviewState === "passed",
      changedFiles: rawChangedFileMapping(finding),
      evidenceArtifactRef: artifactReferenceOf(finding),
      fingerprint: finding.fingerprint,
      mergePolicy: batch.mergePolicy,
      requestedMergePolicy: finding.mergePolicy,
      reviewState: state.reviewState,
      rootCauseKey: rootCauseKeyOf(finding),
      source: finding.source,
      status,
      title: finding.title,
      validationState: state.validationState,
    };
  });

  return {
    autoMergeEligible,
    autoMergeEnabled,
    batchKind: batch.batchKind,
    branchName: batch.branchName,
    cycles,
    escalationReason: secondCycleFailed
      ? "second_cycle_failed"
      : secondCycleIncomplete
        ? "second_cycle_incomplete"
        : !fixed && latest
          ? "first_cycle_failed"
          : undefined,
    findings,
    fixed,
    linearRequired,
    mergePolicy: batch.mergePolicy,
    merged,
    reviewState,
    snapshotId: batch.snapshotId,
    status,
    validationState,
  };
}

function markdownValue(value: string): string {
  return value
    .replace(/[\r\n\t]+/g, " ")
    .replace(/`/g, "'")
    .replace(/https?:\/\/\S+/gi, "[redacted-url]")
    .trim();
}

export function redactEvidenceArtifactReference(
  reference: string | null,
): string {
  if (!reference) return "[redacted]/none";
  const withoutQuery = reference.trim().replace(/[?#].*$/, "");
  const pieces = withoutQuery.replace(/\\/g, "/").split("/");
  const basename = pieces.at(-1) ?? "";
  const safeName = basename
    .replace(
      /(?:token|secret|password|authorization|bearer)[^./_-]*/gi,
      "redacted",
    )
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return `[redacted]/${safeName || "artifact"}`;
}

function findingResultSort(
  left: RepairFindingResult,
  right: RepairFindingResult,
): number {
  return compareText(left.fingerprint, right.fingerprint);
}

function repairResultForBody(input: RepairResult | RepairBatch): RepairResult {
  if ("cycles" in input) return input;
  return evaluateRepairCycles(input, []);
}

export function buildRepairPrBody(input: RepairResult | RepairBatch): string {
  const result = repairResultForBody(input);
  const lines: string[] = [
    `# Health repair: ${result.batchKind} batch`,
    "",
    `<!-- health-agent:repair snapshot_id=${markdownValue(result.snapshotId)} -->`,
    `- snapshot_id: \`${markdownValue(result.snapshotId)}\``,
    `- branch: \`${markdownValue(result.branchName)}\``,
    `- merge_policy: ${result.mergePolicy}`,
    `- validation_state: ${result.validationState}`,
    `- review_state: ${result.reviewState}`,
    `- status: ${result.status}`,
    `- linear_required: ${String(result.linearRequired)}`,
    `- auto_merge_enabled: ${String(result.autoMergeEnabled)}`,
    `- auto_merge_eligible: ${String(result.autoMergeEligible)}`,
    `- merged: ${String(result.merged)}`,
    `- fixed: ${String(result.fixed)}`,
    `- cycles_used: ${String(result.cycles.length)}`,
    "",
    "## Findings",
  ];

  const findings = [...result.findings].sort(findingResultSort);
  if (findings.length === 0) {
    lines.push("No findings in this snapshot.");
    return lines.join("\n");
  }

  findings.forEach((finding, index) => {
    lines.push(
      `### ${String(index + 1)}. ${markdownValue(finding.title)}`,
      `- fingerprint: \`${markdownValue(finding.fingerprint)}\``,
      `- source: \`${markdownValue(finding.source)}\``,
      `- root_cause_key: \`${markdownValue(finding.rootCauseKey)}\``,
      `- evidence_artifact_ref: \`${redactEvidenceArtifactReference(finding.evidenceArtifactRef)}\``,
      `- changed_files: ${
        finding.changedFiles.length > 0
          ? finding.changedFiles
              .map((path) => `\`${markdownValue(path)}\``)
              .join(", ")
          : "none"
      }`,
      `- changed_file_mapping: ${
        finding.changedFiles.length > 0
          ? finding.changedFiles
              .map((path) => `\`${markdownValue(path)}\``)
              .join(", ")
          : "none"
      }`,
      `- validation_state: ${finding.validationState}`,
      `- review_state: ${finding.reviewState}`,
      `- requested_merge_policy: ${finding.requestedMergePolicy}`,
      `- merge_policy: ${finding.mergePolicy}`,
      `- auto_merge_eligible: ${String(finding.autoMergeEligible)}`,
      `- status: ${finding.status}`,
      "",
    );
  });

  return lines.join("\n");
}
