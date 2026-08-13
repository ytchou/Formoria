import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

import {
  checkReleaseSource,
  parseReleasePolicy,
} from "./check-release-source.mjs";

const policy = JSON.stringify({
  version: 1,
  developmentPullRequestBase: "staging",
  release: { source: "staging", target: "main", mergeMethod: "merge" },
  allowDirectProductionPullRequests: false,
});

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

  it("permits only staging as the source of a production pull request", () => {
    expect(
      checkReleaseSource({
        baseRef: "main",
        headRef: "staging",
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
        policyText: policy,
      }),
    ).toThrow(/must come from staging/);
  });

  it("does not treat a staging branch as intent when checking another base", () => {
    expect(
      checkReleaseSource({
        baseRef: "develop",
        headRef: "staging",
        policyText: policy,
      }),
    ).toMatchObject({
      allowed: true,
      checked: false,
    });
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
