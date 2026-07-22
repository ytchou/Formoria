import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  evaluateChangePolicy,
  parseChangePolicyInput,
  type ChangePolicyInput,
  type ChangedFile,
  type PullRequestReview,
} from "./change-policy";

const HEAD_SHA = "a".repeat(40);

function changedFile(overrides: Partial<ChangedFile> = {}): ChangedFile {
  return {
    filename: "src/lib/format-brand.ts",
    status: "modified",
    additions: 2,
    deletions: 1,
    patch: "@@ -1 +1 @@\n-old\n+new",
    ...overrides,
  };
}

function review(overrides: Partial<PullRequestReview> = {}): PullRequestReview {
  return {
    state: "APPROVED",
    commitId: HEAD_SHA,
    authorAssociation: "MEMBER",
    user: { login: "human-reviewer", type: "User" },
    ...overrides,
  };
}

function input(
  files: ChangedFile[],
  reviews: PullRequestReview[] = [],
): ChangePolicyInput {
  return {
    pullRequest: { number: 42, headSha: HEAD_SHA },
    files,
    reviews,
  };
}

describe("change policy", () => {
  it("keeps stable, read-only PR checks without production credentials", async () => {
    const workflow = await readFile(
      ".github/workflows/frontend-ci.yml",
      "utf8",
    );

    expect(workflow).toContain("name: Quality");
    expect(workflow).toContain("name: Change Policy");
    expect(workflow).toContain("pull_request_review:");
    expect(workflow).not.toMatch(/pull_request:\n(?:.|\n)*?\n\s+paths:/);
    expect(workflow).not.toContain("dependabot[bot]");
    expect(workflow).not.toContain("secrets.SUPABASE_SERVICE_ROLE_KEY");
    expect(workflow).toContain(
      "SUPABASE_SERVICE_ROLE_KEY: ci-local-service-role-key",
    );
    expect(workflow).not.toMatch(/(?:contents|pull-requests): write/);
    expect(workflow).toContain("run: pnpm lint");
    expect(workflow).toContain("run: pnpm tsc --noEmit");
    expect(workflow).toContain("run: pnpm knip");
    expect(workflow).toContain("run: pnpm test -- --coverage");
    expect(workflow).toContain("run: pnpm build");
    expect(
      workflow.indexOf("Collect authoritative pull request evidence"),
    ).toBeLessThan(
      workflow.indexOf("run: pnpm tsx scripts/ci/change-policy.ts"),
    );
  });

  it("automatically permits ordinary application changes", () => {
    expect(evaluateChangePolicy(input([changedFile()]))).toEqual({
      requiresApproval: false,
      approved: true,
      reasons: [],
      approvers: [],
    });
  });

  it("does not blanket-gate an ordinary test addition", () => {
    const result = evaluateChangePolicy(
      input([
        changedFile({
          filename: "src/lib/format-brand.test.ts",
          status: "added",
          additions: 3,
          deletions: 0,
          patch:
            '@@ -0,0 +1,3 @@\n+it("formats", () => {\n+  expect(format()).toBe("ok")\n+})',
        }),
      ]),
    );

    expect(result.requiresApproval).toBe(false);
    expect(result.approved).toBe(true);
  });

  it.each([
    [".github/workflows/frontend-ci.yml", "GitHub workflow"],
    [".github/health-agent/repair.md", "agent control plane or prompt"],
    [
      "docs/routines/formoria-health-prompt.md",
      "agent control plane or prompt",
    ],
    ["src/lib/auth/require-admin.ts", "authentication or permissions boundary"],
    [
      "src/lib/internal/personal-os-auth.ts",
      "authentication or permissions boundary",
    ],
    ["src/proxy.ts", "authentication or permissions boundary"],
    ["supabase/migrations/20260723000000_policy.sql", "database migration"],
    ["scripts/ci/change-policy.ts", "change policy"],
    [".github/CODEOWNERS", "CODEOWNERS policy"],
    ["vitest.config.ts", "validation configuration"],
  ])("requires human approval for %s", (filename, reason) => {
    const result = evaluateChangePolicy(input([changedFile({ filename })]));

    expect(result.requiresApproval).toBe(true);
    expect(result.approved).toBe(false);
    expect(result.reasons).toContain(`${filename}: ${reason}`);
  });

  it("accepts a current-head approval from a trusted human", () => {
    const result = evaluateChangePolicy(
      input(
        [changedFile({ filename: ".github/workflows/frontend-ci.yml" })],
        [review()],
      ),
    );

    expect(result.approved).toBe(true);
    expect(result.approvers).toEqual(["human-reviewer"]);
  });

  it.each([
    review({ commitId: "b".repeat(40) }),
    review({ user: { login: "dependabot[bot]", type: "Bot" } }),
    review({ authorAssociation: "CONTRIBUTOR" }),
  ])("rejects stale, bot, or untrusted approvals", (untrustedReview) => {
    const result = evaluateChangePolicy(
      input(
        [
          changedFile({
            filename: "supabase/migrations/20260723000000_policy.sql",
          }),
        ],
        [untrustedReview],
      ),
    );

    expect(result.approved).toBe(false);
    expect(result.approvers).toEqual([]);
  });

  it("uses the latest decisive review from each reviewer", () => {
    const result = evaluateChangePolicy(
      input(
        [changedFile({ filename: ".github/CODEOWNERS" })],
        [review(), review({ state: "CHANGES_REQUESTED" })],
      ),
    );

    expect(result.approved).toBe(false);
  });

  it.each([
    changedFile({
      filename: "src/lib/format-brand.test.ts",
      patch: '@@ -1 +1 @@\n-it("works", () => {})\n+it.skip("works", () => {})',
    }),
    changedFile({
      filename: "src/lib/format-brand.test.ts",
      patch: "@@ -1,2 +1 @@\n-expect(actual).toBe(expected)\n context",
    }),
    changedFile({
      filename: "e2e/brand.spec.ts",
      status: "removed",
      additions: 0,
      deletions: 20,
      patch: undefined,
    }),
    changedFile({
      filename: "package.json",
      patch: '@@ -1 +1 @@\n-"lint": "eslint"\n+"lint:old": "eslint"',
    }),
  ])("requires approval for validation weakening", (file) => {
    const result = evaluateChangePolicy(input([file]));

    expect(result.requiresApproval).toBe(true);
    expect(result.approved).toBe(false);
  });

  it("fails closed on missing or malformed evidence", () => {
    expect(() =>
      parseChangePolicyInput({
        pullRequest: { number: 42, headSha: HEAD_SHA },
        files: [],
        reviews: [],
      }),
    ).toThrow("at least one changed file");

    expect(() =>
      parseChangePolicyInput({
        pullRequest: { number: 42, headSha: HEAD_SHA },
        files: [
          {
            filename: ".github/workflows/frontend-ci.yml",
            status: "mystery",
            additions: 1,
            deletions: 0,
          },
        ],
        reviews: [],
      }),
    ).toThrow("status is not recognized");

    expect(() =>
      parseChangePolicyInput({
        pullRequest: { number: 42, headSha: HEAD_SHA },
        files: [changedFile()],
        reviews: [review({ state: "UNKNOWN" })],
      }),
    ).toThrow("state is not recognized");
  });
});
