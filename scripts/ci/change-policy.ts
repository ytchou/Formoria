import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const TRUSTED_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const DECISIVE_REVIEW_STATES = new Set([
  "APPROVED",
  "CHANGES_REQUESTED",
  "DISMISSED",
]);
const VALID_REVIEW_STATES = new Set([
  ...DECISIVE_REVIEW_STATES,
  "COMMENTED",
  "PENDING",
]);
const VALID_ASSOCIATIONS = new Set([
  "COLLABORATOR",
  "CONTRIBUTOR",
  "FIRST_TIMER",
  "FIRST_TIME_CONTRIBUTOR",
  "MANNEQUIN",
  "MEMBER",
  "NONE",
  "OWNER",
]);
const VALID_USER_TYPES = new Set(["Bot", "Mannequin", "Organization", "User"]);
const VALID_FILE_STATUSES = new Set([
  "added",
  "modified",
  "removed",
  "renamed",
  "copied",
  "changed",
  "unchanged",
]);

export interface ChangedFile {
  filename: string;
  previousFilename?: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}

export interface PullRequestReview {
  state: string;
  commitId: string;
  authorAssociation: string;
  user: {
    login: string;
    type: string;
  };
}

export interface PullRequestAuthor {
  login: string;
  type: string;
  association: string;
}

export interface ChangePolicyInput {
  pullRequest: {
    number: number;
    headSha: string;
    author: PullRequestAuthor;
  };
  files: ChangedFile[];
  reviews: PullRequestReview[];
}

export interface ChangePolicyResult {
  requiresApproval: boolean;
  approved: boolean;
  reasons: string[];
  approvers: string[];
  authorExempt: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function requiredInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
  return Number(value);
}

function requiredSha(value: unknown, label: string): string {
  const sha = requiredString(value, label);
  if (!/^[a-f0-9]{40}$/i.test(sha)) {
    throw new Error(`${label} must be a 40-character hexadecimal commit SHA`);
  }
  return sha;
}

function parseChangedFile(value: unknown, index: number): ChangedFile {
  if (!isRecord(value)) {
    throw new Error(`files[${index}] must be an object`);
  }

  const status = requiredString(
    value.status,
    `files[${index}].status`,
  ).toLowerCase();
  if (!VALID_FILE_STATUSES.has(status)) {
    throw new Error(`files[${index}].status is not recognized`);
  }

  const previousFilename =
    value.previousFilename === undefined
      ? undefined
      : requiredString(
          value.previousFilename,
          `files[${index}].previousFilename`,
        );
  const patch =
    value.patch === undefined
      ? undefined
      : requiredString(value.patch, `files[${index}].patch`);

  return {
    filename: requiredString(value.filename, `files[${index}].filename`),
    ...(previousFilename ? { previousFilename } : {}),
    status,
    additions: requiredInteger(value.additions, `files[${index}].additions`),
    deletions: requiredInteger(value.deletions, `files[${index}].deletions`),
    ...(patch ? { patch } : {}),
  };
}

function parseReview(value: unknown, index: number): PullRequestReview {
  if (!isRecord(value) || !isRecord(value.user)) {
    throw new Error(`reviews[${index}] and its user must be objects`);
  }

  const state = requiredString(
    value.state,
    `reviews[${index}].state`,
  ).toUpperCase();
  const authorAssociation = requiredString(
    value.authorAssociation,
    `reviews[${index}].authorAssociation`,
  ).toUpperCase();
  const userType = requiredString(
    value.user.type,
    `reviews[${index}].user.type`,
  );
  if (!VALID_REVIEW_STATES.has(state)) {
    throw new Error(`reviews[${index}].state is not recognized`);
  }
  if (!VALID_ASSOCIATIONS.has(authorAssociation)) {
    throw new Error(`reviews[${index}].authorAssociation is not recognized`);
  }
  if (!VALID_USER_TYPES.has(userType)) {
    throw new Error(`reviews[${index}].user.type is not recognized`);
  }

  return {
    state,
    commitId: requiredSha(value.commitId, `reviews[${index}].commitId`),
    authorAssociation,
    user: {
      login: requiredString(value.user.login, `reviews[${index}].user.login`),
      type: userType,
    },
  };
}

function parsePullRequestAuthor(value: unknown): PullRequestAuthor {
  if (!isRecord(value)) {
    throw new Error("pullRequest.author must be an object");
  }

  const type = requiredString(value.type, "pullRequest.author.type");
  const association = requiredString(
    value.association,
    "pullRequest.author.association",
  ).toUpperCase();
  if (!VALID_USER_TYPES.has(type)) {
    throw new Error("pullRequest.author.type is not recognized");
  }
  if (!VALID_ASSOCIATIONS.has(association)) {
    throw new Error("pullRequest.author.association is not recognized");
  }

  return {
    login: requiredString(value.login, "pullRequest.author.login"),
    type,
    association,
  };
}

export function parseChangePolicyInput(value: unknown): ChangePolicyInput {
  if (!isRecord(value) || !isRecord(value.pullRequest)) {
    throw new Error("policy input and pullRequest must be objects");
  }
  if (!Array.isArray(value.files) || !Array.isArray(value.reviews)) {
    throw new Error("policy input files and reviews must be arrays");
  }
  if (value.files.length === 0) {
    throw new Error("policy input must contain at least one changed file");
  }

  return {
    pullRequest: {
      number: requiredInteger(value.pullRequest.number, "pullRequest.number"),
      headSha: requiredSha(value.pullRequest.headSha, "pullRequest.headSha"),
      author: parsePullRequestAuthor(value.pullRequest.author),
    },
    files: value.files.map(parseChangedFile),
    reviews: value.reviews.map(parseReview),
  };
}

function isTrustedHumanAuthor(author: PullRequestAuthor): boolean {
  return (
    author.type === "User" &&
    !author.login.endsWith("[bot]") &&
    TRUSTED_ASSOCIATIONS.has(author.association)
  );
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

function isTestFile(path: string): boolean {
  return (
    /(^|\/)(?:e2e|tests?|__tests__)(\/|$)/i.test(path) ||
    /\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(path)
  );
}

function isValidationConfig(path: string): boolean {
  return (
    /(^|\/)(?:eslint\.config\.[cm]?[jt]s|knip\.json|playwright\.config\.[cm]?[jt]s|tsconfig(?:\.[^/]+)?\.json|vite\.config\.[cm]?[jt]s|vitest\.config\.[cm]?[jt]s)$/i.test(
      path,
    ) || path === "package.json"
  );
}

function controlPlaneReason(path: string): string | null {
  if (path.startsWith(".github/workflows/")) return "GitHub workflow";
  if (path === ".github/CODEOWNERS") return "CODEOWNERS policy";
  if (path.startsWith("scripts/ci/change-policy.")) return "change policy";
  if (path.startsWith("supabase/migrations/")) return "database migration";
  if (
    path.startsWith(".github/health-agent/") ||
    path.startsWith(".github/selfheal/") ||
    path.startsWith("scripts/health-agent/") ||
    /(^|\/)[^/]*prompt[^/]*\.(?:md|txt)$/i.test(path)
  ) {
    return "agent control plane or prompt";
  }
  const fileName = path.split("/").at(-1) ?? path;
  if (
    /(^|\/)(?:auth|authorization|permissions?)(?:\/|[._-])/i.test(path) ||
    /(?:^|[._-])(?:auth|authentication|authorization|permissions?)(?:[._-]|$)/i.test(
      fileName.replace(/\.[cm]?[jt]sx?$/i, ""),
    ) ||
    /(^|\/)(?:middleware|permissions?|proxy|rbac)\.[cm]?[jt]sx?$/i.test(path)
  ) {
    return "authentication or permissions boundary";
  }
  if (/(^|\/)[^/]*merge[-_.]?policy[^/]*(\/|$)/i.test(path)) {
    return "merge policy";
  }
  if (isValidationConfig(path) && path !== "package.json") {
    return "validation configuration";
  }
  return null;
}

const ADDED_WEAKENING_PATTERNS: Array<[RegExp, string]> = [
  [/\.(?:skip|only)\s*\(/, "focused or skipped test"],
  [/\b(?:it|test|describe)\.todo\s*\(/, "todo test"],
  [/\bcontinue-on-error\s*:\s*true\b/i, "allowed validation failure"],
  [/(?:^|\s)\|\|\s*true(?:\s|$)/, "swallowed command failure"],
  [/--passWithNoTests\b/, "allowed empty test suite"],
  [/@ts-(?:ignore|nocheck)\b/, "TypeScript suppression"],
  [/eslint-disable(?:-next-line)?\b/, "lint suppression"],
];

function patchLines(patch: string, marker: "+" | "-"): string[] {
  return patch
    .split("\n")
    .filter(
      (line) =>
        line.startsWith(marker) &&
        !line.startsWith(`${marker}${marker}${marker}`),
    )
    .map((line) => line.slice(1));
}

function validationWeakeningReason(
  file: ChangedFile,
  path: string,
): string | null {
  const testFile = isTestFile(path);
  if (testFile && file.status === "removed") return "deleted validation file";

  if (!testFile && path !== "package.json") return null;
  if (!file.patch) return "validation diff could not be inspected";

  const added = patchLines(file.patch, "+");
  const removed = patchLines(file.patch, "-");
  for (const line of added) {
    const match = ADDED_WEAKENING_PATTERNS.find(([pattern]) =>
      pattern.test(line),
    );
    if (match) return match[1];
  }

  if (testFile) {
    const assertionPattern = /\b(?:expect|assert(?:\.|\s*\())/;
    const assertionsAdded = added.filter((line) =>
      assertionPattern.test(line),
    ).length;
    const assertionsRemoved = removed.filter((line) =>
      assertionPattern.test(line),
    ).length;
    if (assertionsRemoved > assertionsAdded) return "removed test assertion";
  }

  if (path === "package.json") {
    const validationScript =
      /"(?:lint|test(?::[^"]*)?|build|knip|type-?check)"\s*:/i;
    if (removed.some((line) => validationScript.test(line))) {
      return "removed or changed validation script";
    }
  }

  return null;
}

function currentTrustedApprovers(input: ChangePolicyInput): string[] {
  const latestDecisiveReviews = new Map<string, PullRequestReview>();
  for (const review of input.reviews) {
    if (DECISIVE_REVIEW_STATES.has(review.state)) {
      latestDecisiveReviews.set(review.user.login.toLowerCase(), review);
    }
  }

  return [...latestDecisiveReviews.values()]
    .filter(
      (review) =>
        review.state === "APPROVED" &&
        review.commitId === input.pullRequest.headSha &&
        review.user.type === "User" &&
        !review.user.login.endsWith("[bot]") &&
        TRUSTED_ASSOCIATIONS.has(review.authorAssociation),
    )
    .map((review) => review.user.login)
    .sort((left, right) => left.localeCompare(right));
}

export function evaluateChangePolicy(
  input: ChangePolicyInput,
): ChangePolicyResult {
  const reasons = new Set<string>();

  for (const file of input.files) {
    const currentPath = normalizePath(file.filename);
    const paths = file.previousFilename
      ? [currentPath, normalizePath(file.previousFilename)]
      : [currentPath];

    for (const path of paths) {
      const controlReason = controlPlaneReason(path);
      if (controlReason) reasons.add(`${path}: ${controlReason}`);
    }

    const weakeningReason = validationWeakeningReason(file, currentPath);
    if (weakeningReason) reasons.add(`${currentPath}: ${weakeningReason}`);
  }

  const sortedReasons = [...reasons].sort((left, right) =>
    left.localeCompare(right),
  );
  const approvers = currentTrustedApprovers(input);
  const authorExempt =
    sortedReasons.length > 0 && isTrustedHumanAuthor(input.pullRequest.author);
  return {
    requiresApproval: sortedReasons.length > 0,
    approved:
      sortedReasons.length === 0 || authorExempt || approvers.length > 0,
    reasons: sortedReasons,
    approvers,
    authorExempt,
  };
}

async function main(args: string[]): Promise<void> {
  const inputFlag = args.indexOf("--input");
  const inputPath = inputFlag >= 0 ? args.at(inputFlag + 1) : undefined;
  if (!inputPath)
    throw new Error("Usage: change-policy.ts --input <evidence.json>");

  const rawInput: unknown = JSON.parse(await readFile(inputPath, "utf8"));
  const input = parseChangePolicyInput(rawInput);
  const result = evaluateChangePolicy(input);

  if (!result.approved) {
    throw new Error(
      [
        "A current-head approval from a trusted human is required:",
        ...result.reasons.map((reason) => `- ${reason}`),
      ].join("\n"),
    );
  }

  if (result.authorExempt) {
    console.log(
      `Change Policy passed: PR authored by trusted human ${input.pullRequest.author.login}; flagged changes: ${result.reasons.length}.`,
    );
  } else if (result.requiresApproval) {
    console.log(
      `Change Policy passed with approval from ${result.approvers.join(", ")}.`,
    );
  } else {
    console.log(
      "Change Policy passed automatically; no human-gated changes detected.",
    );
  }
}

const invokedPath = process.argv.at(1);
if (
  invokedPath &&
  import.meta.url === pathToFileURL(resolve(invokedPath)).href
) {
  void main(process.argv.slice(2)).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Change Policy failed: ${message}`);
    process.exitCode = 1;
  });
}
