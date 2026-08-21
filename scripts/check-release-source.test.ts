import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

import {
  checkReleaseSource,
  parseReleasePolicy,
} from "./check-release-source.mjs";

const policy = JSON.stringify({
  version: 1,
  developmentPullRequestBase: "staging",
  release: {
    source: "staging",
    target: "main",
    mergeMethod: "merge",
    candidatePrefix: "release/candidate-",
  },
  allowDirectProductionPullRequests: false,
});

function cliEnvWithoutRepositoryIdentity(
  overrides: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => key !== "GITHUB_HEAD_REPO" && key !== "GITHUB_REPOSITORY",
    ),
  );
  return {
    ...env,
    ...overrides,
    NODE_ENV: process.env.NODE_ENV ?? "test",
  };
}

describe("release source guard", () => {
  it("runs when an existing pull request is retargeted into production", async () => {
    const workflow = await readFile(
      ".github/workflows/release-source.yml",
      "utf8",
    );
    expect(workflow).toContain(
      "types: [opened, synchronize, reopened, edited]",
    );
  });

  it("runs trusted guard code from the repository default branch", async () => {
    const workflow = await readFile(
      ".github/workflows/release-source.yml",
      "utf8",
    );

    expect(workflow).toContain("pull_request_target:");
    expect(workflow).toContain(
      "ref: ${{ github.event.repository.default_branch }}",
    );
    expect(workflow).toContain("GITHUB_REPOSITORY: ${{ github.repository }}");
  });

  it("bootstraps the first same-repository release when production has no policy yet", async () => {
    const workflow = await readFile(
      ".github/workflows/release-source.yml",
      "utf8",
    );
    const defaultPolicyLookup = workflow.indexOf("ref=$DEFAULT_BRANCH");
    const bootstrapPolicyLookup = workflow.indexOf("ref=$GITHUB_HEAD_SHA");

    expect(defaultPolicyLookup).toBeGreaterThan(-1);
    expect(bootstrapPolicyLookup).toBeGreaterThan(defaultPolicyLookup);
    expect(workflow).toContain('grep -q "HTTP 404"');
    expect(workflow).toContain(
      '[[ "$GITHUB_HEAD_REPO" != "$GITHUB_REPOSITORY" ]]',
    );
  });

  it("permits only staging as the source of a production pull request", () => {
    expect(
      checkReleaseSource({
        baseRef: "main",
        headRef: "staging",
        headRepo: "ytchou/formoria",
        repository: "ytchou/formoria",
        policyText: policy,
      }),
    ).toMatchObject({
      allowed: true,
      checked: true,
    });
    expect(() =>
      checkReleaseSource({
        baseRef: "main",
        headRef: "feature/landing",
        headRepo: "ytchou/formoria",
        repository: "ytchou/formoria",
        policyText: policy,
      }),
    ).toThrow(/must come from staging/);
  });

  it("permits only same-repository candidate heads with a non-empty configured suffix", () => {
    expect(
      checkReleaseSource({
        baseRef: "main",
        headRef: "release/candidate-20260813",
        headRepo: "ytchou/formoria",
        repository: "ytchou/formoria",
        policyText: policy,
      }),
    ).toMatchObject({
      allowed: true,
      checked: true,
    });
    expect(() =>
      checkReleaseSource({
        baseRef: "main",
        headRef: "release/candidate-20260813",
        headRepo: "contributor/formoria",
        repository: "ytchou/formoria",
        policyText: policy,
      }),
    ).toThrow(/does not match/);
    expect(() =>
      checkReleaseSource({
        baseRef: "main",
        headRef: "release/candidate",
        headRepo: "ytchou/formoria",
        repository: "ytchou/formoria",
        policyText: policy,
      }),
    ).toThrow(/must come from/);
    expect(() =>
      checkReleaseSource({
        baseRef: "main",
        headRef: "release/candidate-",
        headRepo: "ytchou/formoria",
        repository: "ytchou/formoria",
        policyText: policy,
      }),
    ).toThrow(/must come from/);
  });

  it("rejects a fork's staging branch as a production source", () => {
    expect(() =>
      checkReleaseSource({
        baseRef: "main",
        headRef: "staging",
        headRepo: "contributor/formoria",
        repository: "ytchou/formoria",
        policyText: policy,
      }),
    ).toThrow(
      /head repository contributor\/formoria does not match ytchou\/formoria/,
    );
  });

  it("does not treat a staging branch as intent when checking another base", () => {
    expect(
      checkReleaseSource({
        baseRef: "develop",
        headRef: "staging",
        headRepo: "ytchou/formoria",
        repository: "ytchou/formoria",
        policyText: policy,
      }),
    ).toMatchObject({
      allowed: true,
      checked: false,
    });
  });

  it("keeps non-production CLI checks skippable without repository identity", () => {
    expect(
      execFileSync(process.execPath, ["scripts/check-release-source.mjs"], {
        cwd: process.cwd(),
        encoding: "utf8",
        env: cliEnvWithoutRepositoryIdentity({
          GITHUB_BASE_REF: "develop",
          GITHUB_HEAD_REF: "staging",
        }),
      }),
    ).toContain("Release source: skipped for staging -> develop");
  });

  it("fails closed for production CLI checks without repository identity", () => {
    expect(() =>
      execFileSync(process.execPath, ["scripts/check-release-source.mjs"], {
        cwd: process.cwd(),
        encoding: "utf8",
        env: cliEnvWithoutRepositoryIdentity({
          GITHUB_BASE_REF: "main",
          GITHUB_HEAD_REF: "staging",
        }),
      }),
    ).toThrow(/head repository \(missing\) does not match \(missing\)/);
  });

  it("fails closed for malformed policy content", () => {
    expect(() => parseReleasePolicy('{"version":1}')).toThrow(
      /developmentPullRequestBase/,
    );
    expect(() =>
      parseReleasePolicy(
        '{"version":1,"developmentPullRequestBase":"staging","release":{"source":"staging","target":"main","mergeMethod":"squash"},"allowDirectProductionPullRequests":false}',
      ),
    ).toThrow(/mergeMethod/);
  });
});

/**
 * The staging E2E gate is the last automated check before production. It used
 * to carry its own literal list of legal release heads, which drifted from the
 * guard above: `release/candidate-*` passed the guard, the gate skipped itself,
 * and GitHub read the skip as a satisfied required check (DEV-1536, PR #808).
 *
 * These assertions read the workflow as text, so `vitest --changed` will not
 * select this file when only the YAML moves. CI runs it unconditionally in the
 * lint job for that reason.
 */
describe("staging E2E release gate", () => {
  async function releaseGate() {
    return readFile(".github/workflows/e2e-release.yml", "utf8");
  }

  it("runs on every pull request into production rather than skipping", async () => {
    const workflow = await releaseGate();
    expect(workflow).not.toMatch(/^\s*if:.*pull_request\.head\.ref/m);
  });

  it("keeps no accepted-head list of its own", async () => {
    const workflow = await releaseGate();
    expect(workflow).toContain("run: node scripts/check-release-source.mjs");
    expect(workflow).not.toMatch(/head\.ref\s*==\s*'staging'/);
  });

  it("refuses to certify a candidate head against deployed staging", async () => {
    const workflow = await releaseGate();
    expect(workflow).toMatch(
      /if \[\[ "\$RELEASE_HEAD_REF" != "staging" \]\]; then/,
    );
    expect(workflow).toContain("cannot be certified against deployed staging");
  });
});
