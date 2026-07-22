import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

function remoteActions(workflow: string): string[] {
  return [...workflow.matchAll(/^\s*(?:-\s*)?uses:\s*([^\s#]+).*$/gm)].map(
    (match) => match[1] ?? "",
  );
}

describe("E2E workflow contracts", () => {
  it("always creates a secretless local Integration check for pull requests", async () => {
    const workflow = await readFile(".github/workflows/e2e-pr.yml", "utf8");

    expect(workflow).toMatch(/^name: Integration$/m);
    expect(workflow).toMatch(/^    name: Integration$/m);
    expect(workflow).toContain("pull_request:");
    expect(workflow).not.toContain("    paths:");
    expect(workflow).not.toContain("${{ secrets.");
    expect(workflow).toContain("supabase@2.109.1 start");
    expect(workflow).toContain("supabase@2.109.1 migration up --local");
    expect(workflow).toContain("db query --local --file supabase/seed.sql");
    expect(workflow).toContain("node scripts/ci/seed-local-e2e.mjs");
    expect(workflow).toContain("run: pnpm build");
    expect(workflow).toContain("--only-changed=origin/main");
    expect(workflow).not.toContain("continue-on-error");
    expect(workflow).not.toMatch(/^\s*if:.*actor/m);
    expect(workflow.indexOf("run: pnpm build")).toBeGreaterThan(
      workflow.indexOf("jobs:"),
    );
    expect(
      remoteActions(workflow).every((action) => /@[0-9a-f]{40}$/.test(action)),
    ).toBe(true);
  });

  it("keeps nightly writer serialization and reports auto-merge honestly", async () => {
    const workflow = await readFile(
      ".github/workflows/e2e-nightly.yml",
      "utf8",
    );

    expect(workflow).toContain("group: formoria-agent-writer");
    expect(workflow).not.toContain("continue-on-error");
    expect(workflow).not.toContain("merged=true");
    expect(workflow).not.toContain("MERGED_FOR_REPORT");
    expect(workflow).toContain("auto_merge_enabled=true");
    expect(workflow).toContain(
      'auto_merge_enabled: ($auto_merge_enabled == "true")',
    );
    expect(workflow).toMatch(/anthropics\/claude-code-action@[0-9a-f]{40}/);
    expect(workflow).toContain("steps.fix.outputs.structured_output");
    expect(workflow).not.toContain("steps.fix.outputs.result");
    expect(workflow).toContain('--json-schema {"type":"object"');
    expect(workflow).toMatch(/pnpm\/action-setup@[0-9a-f]{40}/);
    expect(
      remoteActions(workflow).every((action) => /@[0-9a-f]{40}$/.test(action)),
    ).toBe(true);
  });

  it("pins every remote action in the stable pull-request checks", async () => {
    const workflow = await readFile(
      ".github/workflows/frontend-ci.yml",
      "utf8",
    );
    const actions = remoteActions(workflow);

    expect(actions.length).toBeGreaterThan(0);
    expect(actions.every((action) => /@[0-9a-f]{40}$/.test(action))).toBe(true);
  });

  it("propagates real Playwright failures and only accepts no-tests status", () => {
    const run = (status: string) =>
      spawnSync("bash", ["scripts/ci/normalize-playwright-exit.sh", status], {
        encoding: "utf8",
      });

    expect(run("0").status).toBe(0);
    expect(run("4").status).toBe(0);
    expect(run("1").status).toBe(1);
    expect(run("2").status).toBe(2);
    expect(run("invalid").status).toBe(2);
  });
});
