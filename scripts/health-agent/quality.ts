import path from "node:path";
import { createHash } from "node:crypto";

import {
  stableFingerprint,
  type HealthFinding,
  type JsonValue,
} from "./contracts";
import { isKnownKnipNoise } from "./knip-known-noise";

const KNIP_KINDS = [
  "binaries",
  "catalog",
  "dependencies",
  "devDependencies",
  "duplicates",
  "enumMembers",
  "exports",
  "files",
  "namespaceMembers",
  "optionalPeerDependencies",
  "types",
  "unlisted",
  "unresolved",
] as const;

type QualityStatus = "failed" | "success";
type UnknownRecord = Record<string, unknown>;

export interface QualityReportsInput {
  knipExitCode: number;
  knipReport: unknown;
  repoRoot: string;
  trackedFiles: ReadonlySet<string>;
  vitestExitCode: number;
  vitestReport: unknown;
}

export interface QualityHealthResult {
  failures: string[];
  findings: HealthFinding[];
  status: QualityStatus;
  summary: {
    deadCode: { findingCount: number; status: QualityStatus };
    fullUnitSuite: { findingCount: number; status: QualityStatus };
  };
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonnegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function repositoryPath(value: unknown, repoRoot: string): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const normalized = value.replaceAll("\\", "/");
  const root = repoRoot.replaceAll("\\", "/").replace(/\/$/, "");
  const relative = normalized.startsWith(`${root}/`)
    ? normalized.slice(root.length + 1)
    : normalized.replace(/^\.\//, "");
  const repositoryRelative = path.posix.normalize(relative);
  if (
    !repositoryRelative ||
    repositoryRelative.startsWith("../") ||
    path.posix.isAbsolute(repositoryRelative) ||
    repositoryRelative.includes("\0")
  ) {
    return undefined;
  }
  return repositoryRelative;
}

function trackedScope(
  candidates: readonly (string | undefined)[],
  trackedFiles: ReadonlySet<string>,
): string[] {
  return [
    ...new Set(candidates.filter((file): file is string => Boolean(file))),
  ]
    .filter((file) => trackedFiles.has(file))
    .sort();
}

function qualityFinding({
  changedFiles,
  evidence,
  fingerprint,
  severity,
  title,
}: {
  changedFiles: readonly string[];
  evidence: Record<string, JsonValue>;
  fingerprint: string;
  severity: "high" | "medium";
  title: string;
}): HealthFinding {
  return {
    changedFiles,
    evidence: {
      ...evidence,
      changedFiles: [...changedFiles],
      repairScopeTrusted: changedFiles.length > 0,
    },
    fingerprint,
    humanReason: "Repository health repairs require manager review",
    mergePolicy: "human",
    severity,
    source: "quality",
    title,
  };
}

function qualityFingerprint(kind: string, identity: string): string {
  const normalizedIdentity = identity
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._/:+-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  const fingerprint = stableFingerprint("quality", kind, normalizedIdentity);
  if (fingerprint.length <= 128) return fingerprint;
  const digest = createHash("sha256")
    .update(fingerprint)
    .digest("hex")
    .slice(0, 16);
  return `${fingerprint.slice(0, 111)}:${digest}`;
}

function parseStackFiles(
  messages: readonly unknown[],
  repoRoot: string,
): string[] {
  const root = repoRoot.replaceAll("\\", "/").replace(/\/$/, "");
  const files: string[] = [];
  for (const message of messages) {
    if (typeof message !== "string") continue;
    const normalized = message.replaceAll("\\", "/");
    for (const match of normalized.matchAll(/(?:at\s+)?([^\s()]+):\d+:\d+/g)) {
      const file = repositoryPath(match[1], root);
      if (file) files.push(file);
    }
  }
  return files;
}

function parseVitestReport(
  value: unknown,
  exitCode: number,
  repoRoot: string,
  trackedFiles: ReadonlySet<string>,
): HealthFinding[] | null {
  if (
    !isRecord(value) ||
    !nonnegativeInteger(value.numFailedTestSuites) ||
    !nonnegativeInteger(value.numFailedTests) ||
    !nonnegativeInteger(value.numTotalTestSuites) ||
    !nonnegativeInteger(value.numTotalTests) ||
    typeof value.success !== "boolean" ||
    !Array.isArray(value.testResults)
  ) {
    return null;
  }
  if (
    value.numFailedTestSuites > value.numTotalTestSuites ||
    value.numFailedTests > value.numTotalTests ||
    (exitCode === 0 &&
      (!value.success ||
        value.numFailedTestSuites > 0 ||
        value.numFailedTests > 0)) ||
    (exitCode !== 0 &&
      value.success &&
      value.numFailedTestSuites === 0 &&
      value.numFailedTests === 0)
  ) {
    return null;
  }

  const findings: HealthFinding[] = [];
  for (const result of value.testResults) {
    if (!isRecord(result) || typeof result.name !== "string") return null;
    if (!Array.isArray(result.assertionResults)) return null;
    const testFile = repositoryPath(result.name, repoRoot);
    let assertionFailureCount = 0;
    for (const assertion of result.assertionResults) {
      if (!isRecord(assertion) || assertion.status !== "failed") continue;
      assertionFailureCount += 1;
      const testName =
        typeof assertion.fullName === "string" && assertion.fullName.trim()
          ? assertion.fullName.trim()
          : typeof assertion.title === "string" && assertion.title.trim()
            ? assertion.title.trim()
            : undefined;
      if (!testFile || !testName) return null;
      const failureMessages = Array.isArray(assertion.failureMessages)
        ? assertion.failureMessages
        : [];
      const changedFiles = trackedScope(
        [testFile, ...parseStackFiles(failureMessages, repoRoot)],
        trackedFiles,
      );
      findings.push(
        qualityFinding({
          changedFiles,
          evidence: {
            check: "full-unit-suite",
            exitCode,
            testFile,
            testName,
          },
          fingerprint: qualityFingerprint(
            "full-unit-suite",
            `${testFile}::${testName}`,
          ),
          severity: "high",
          title: `Vitest failure: ${testName}`,
        }),
      );
    }
    if (result.status === "failed" && assertionFailureCount === 0) {
      if (!testFile) return null;
      const suiteMessages = [result.message, result.failureMessage].filter(
        (message): message is string => typeof message === "string",
      );
      const changedFiles = trackedScope(
        [testFile, ...parseStackFiles(suiteMessages, repoRoot)],
        trackedFiles,
      );
      findings.push(
        qualityFinding({
          changedFiles,
          evidence: {
            check: "full-unit-suite",
            exitCode,
            testFile,
            testName: "suite failure",
          },
          fingerprint: qualityFingerprint(
            "full-unit-suite",
            `${testFile}::suite-failure`,
          ),
          severity: "high",
          title: `Vitest suite failure: ${testFile}`,
        }),
      );
    }
  }
  if (
    (value.numFailedTests > 0 || value.numFailedTestSuites > 0) &&
    findings.length === 0
  ) {
    return null;
  }
  return findings.sort((left, right) =>
    left.fingerprint.localeCompare(right.fingerprint),
  );
}

function knipSymbol(value: unknown, fallback: string): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  // `duplicates` is the one KNIP_KINDS entry knip reports as an array of
  // arrays: each element is a duplicate *group*, i.e. the list of symbols that
  // share a definition. Every other kind is a flat list of strings or symbol
  // records. Without this branch isRecord() rejects the group (it excludes
  // arrays), knipSymbol returns undefined, and parseKnipReport bails to null —
  // which surfaces as `dead-code:malformed_output`, fails the whole quality
  // group, and takes the nightly health run down with it (DEV-1381). Name the
  // group by its members so the finding is still actionable.
  if (Array.isArray(value)) {
    const members = value
      .map((member, index) => knipSymbol(member, String(index + 1)))
      .filter((member): member is string => Boolean(member));
    return members.length > 0 ? members.join(", ") : fallback;
  }
  if (!isRecord(value)) return undefined;
  for (const key of ["name", "file", "path", "symbol"] as const) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return fallback;
}

function parseKnipReport(
  value: unknown,
  exitCode: number,
  repoRoot: string,
  trackedFiles: ReadonlySet<string>,
): HealthFinding[] | null {
  if (!isRecord(value) || !Array.isArray(value.issues)) return null;
  const findings: HealthFinding[] = [];
  let suppressed = 0;
  for (const issue of value.issues) {
    if (!isRecord(issue)) return null;
    const reportedFile = repositoryPath(issue.file, repoRoot);
    for (const kind of KNIP_KINDS) {
      const entries = issue[kind];
      if (entries === undefined) continue;
      if (!Array.isArray(entries)) return null;
      for (const [index, entry] of entries.entries()) {
        const symbol = knipSymbol(entry, String(index + 1));
        if (!symbol) return null;
        // The suppression list existed and was tested but never consulted, so
        // known false positives were queued as repairs. The repair agent
        // correctly refuses to delete code that is actually used, which then
        // read as a failed repair and blocked the PR (run 31453535132).
        if (isKnownKnipNoise(kind, symbol, reportedFile)) {
          suppressed += 1;
          continue;
        }
        // Kinds the repair agent cannot resolve, whatever it does. Reporting
        // them with an empty scope keeps them visible and ticketable while
        // keeping them out of the repair claim — the same contract every other
        // finding without changedFiles follows. Claiming them spends the budget
        // on work the agent must refuse, and the refusal then reads as a failed
        // repair that discards the whole batch alongside it.
        //
        // - manifest kinds: repair.md forbids touching dependency manifests.
        // - `files`: the fix is deleting the file, and the agent's allow-list
        //   (Read, Edit, Write, Glob, Grep, TodoWrite, a few git/pnpm reads) has
        //   no way to delete one. Emptying it does not help — knip still reports
        //   an unused file. Run 31461399467 lost 24 good repairs to this single
        //   finding, src/components/ui/accordion.tsx.
        const agentCannotRepair =
          kind === "dependencies" ||
          kind === "devDependencies" ||
          kind === "optionalPeerDependencies" ||
          kind === "unlisted" ||
          kind === "binaries" ||
          kind === "files";
        const scopeCandidate = agentCannotRepair ? undefined : reportedFile;
        const changedFiles = trackedScope([scopeCandidate], trackedFiles);
        const identityFile = reportedFile ?? "package.json";
        findings.push(
          qualityFinding({
            changedFiles,
            evidence: {
              check: "dead-code",
              exitCode,
              file: identityFile,
              kind,
              symbol,
            },
            fingerprint: qualityFingerprint(
              "dead-code",
              `${kind}:${identityFile}:${symbol}`,
            ),
            severity: "medium",
            title: `Knip ${kind}: ${symbol}`,
          }),
        );
      }
    }
  }
  if (exitCode === 0 && findings.length > 0) return null;
  // A nonzero knip exit with nothing to report means the parse disagreed with
  // knip — unless every issue it raised was known noise, which is a clean
  // repository, not malformed output.
  if (exitCode !== 0 && findings.length === 0 && suppressed === 0) return null;
  return findings.sort((left, right) =>
    left.fingerprint.localeCompare(right.fingerprint),
  );
}

export function evaluateQualityReports(
  input: QualityReportsInput,
): QualityHealthResult {
  const vitest = parseVitestReport(
    input.vitestReport,
    input.vitestExitCode,
    input.repoRoot,
    input.trackedFiles,
  );
  const knip = parseKnipReport(
    input.knipReport,
    input.knipExitCode,
    input.repoRoot,
    input.trackedFiles,
  );
  const failures = [
    ...(vitest === null ? ["full-unit-suite:malformed_output"] : []),
    ...(knip === null ? ["dead-code:malformed_output"] : []),
  ];
  return {
    failures,
    findings: [...(knip ?? []), ...(vitest ?? [])],
    status: failures.length > 0 ? "failed" : "success",
    summary: {
      deadCode: {
        findingCount: knip?.length ?? 0,
        status: knip === null ? "failed" : "success",
      },
      fullUnitSuite: {
        findingCount: vitest?.length ?? 0,
        status: vitest === null ? "failed" : "success",
      },
    },
  };
}
