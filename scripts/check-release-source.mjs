import { readFileSync } from "node:fs";

const POLICY_PATH = ".github/release-flow.json";

function branchName(value, field) {
  if (
    typeof value !== "string" ||
    !value ||
    !/^[A-Za-z0-9._/-]+$/.test(value) ||
    value.startsWith("-") ||
    value.startsWith("/") ||
    value.endsWith("/") ||
    value.startsWith(".") ||
    value.endsWith(".") ||
    value.endsWith(".lock") ||
    value.includes("..") ||
    value.includes("//") ||
    value.includes("@{") ||
    /\s/.test(value)
  ) {
    throw new Error(`${field} is not a valid branch name: ${String(value)}`);
  }
  return value;
}

export function parseReleasePolicy(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error(`release-flow policy is invalid JSON: ${error.message}`);
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("release-flow policy must be a JSON object");
  }
  if (raw.version !== 1)
    throw new Error("release-flow policy version must be 1");
  const development = branchName(
    raw.developmentPullRequestBase,
    "developmentPullRequestBase",
  );
  const release = raw.release;
  if (!release || typeof release !== "object" || Array.isArray(release)) {
    throw new Error("release-flow policy release must be an object");
  }
  const source = branchName(release.source, "release.source");
  const target = branchName(release.target, "release.target");
  if (release.mergeMethod !== "merge") {
    throw new Error("release.mergeMethod must be 'merge'");
  }
  if (typeof raw.allowDirectProductionPullRequests !== "boolean") {
    throw new Error("allowDirectProductionPullRequests must be a boolean");
  }
  if (source === target || source !== development || target === development) {
    throw new Error(
      "release.source must match developmentPullRequestBase and differ from release.target",
    );
  }
  return {
    version: 1,
    developmentPullRequestBase: development,
    release: { source, target, mergeMethod: "merge" },
    allowDirectProductionPullRequests: raw.allowDirectProductionPullRequests,
  };
}

export function checkReleaseSource({ baseRef, headRef, policyText }) {
  const policy = parseReleasePolicy(policyText);
  if (baseRef !== policy.release.target) {
    return { allowed: true, checked: false, policy };
  }
  if (headRef !== policy.release.source) {
    throw new Error(
      `Release source failed: pull requests into ${policy.release.target} must come from ${policy.release.source}; ` +
        "use promote-staging for a deliberate production release",
    );
  }
  return { allowed: true, checked: true, policy };
}

if (process.argv[1] && process.argv[1].endsWith("check-release-source.mjs")) {
  const baseRef = process.env.GITHUB_BASE_REF ?? process.argv[2];
  const headRef = process.env.GITHUB_HEAD_REF ?? process.argv[3];
  const policyPath = process.env.RELEASE_FLOW_POLICY_PATH ?? POLICY_PATH;
  if (!baseRef || !headRef) {
    console.error(
      "Release source check requires GITHUB_BASE_REF and GITHUB_HEAD_REF",
    );
    process.exit(2);
  }
  try {
    const result = checkReleaseSource({
      baseRef,
      headRef,
      policyText: readFileSync(policyPath, "utf8"),
    });
    if (result.checked) {
      console.log(`Release source: ${headRef} -> ${baseRef}`);
    } else {
      console.log(`Release source: skipped for ${headRef} -> ${baseRef}`);
    }
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exit(1);
  }
}
