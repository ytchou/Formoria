import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";

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
        stdio: ["pipe", "pipe", "pipe"],
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
        stdio: ["pipe", "pipe", "pipe"],
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

