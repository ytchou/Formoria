import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";

const workflowPaths = [
  resolve(import.meta.dirname, "../.github/workflows/e2e-nightly.yml"),
  resolve(import.meta.dirname, "../.github/workflows/e2e-staging.yml"),
  resolve(import.meta.dirname, "../.github/workflows/e2e-release.yml"),
];

describe("deployed staging E2E workflow contract", () => {
  it("uses only the staging environment, origin, project, and credentials", async () => {
    for (const workflowPath of workflowPaths) {
      const source = await readFile(workflowPath, "utf8");
      const workflow = parseYaml(source) as {
        jobs: Record<string, { environment?: string; env?: Record<string, string> }>;
      };
      const jobs = Object.values(workflow.jobs).filter(
        (job) => job.environment && job.env?.SUPABASE_PROJECT_REF,
      );
      expect(jobs.length).toBeGreaterThan(0);
      for (const job of jobs) {
        expect(job.environment).toBe("Formoria / staging");
        expect(job.env?.STAGING_BASE_URL).toBe("https://staging.formoria.com");
        expect(job.env?.BASE_URL).toBe("https://staging.formoria.com");
        for (const name of [
          "SUPABASE_PROJECT_REF",
          "NEXT_PUBLIC_SUPABASE_URL",
          "SUPABASE_SERVICE_ROLE_KEY",
          "E2E_USER_EMAIL",
          "E2E_ADMIN_EMAIL",
        ]) {
          expect(job.env?.[name]).toBe(`\${{ secrets.${name} }}`);
        }
      }
      expect(source).not.toContain("Formoria / production");
      expect(source).not.toContain("localhost:3000");
    }
  });

  it("runs the complete deep/mobile suite without a local build or last-failed selection", async () => {
    for (const workflowPath of workflowPaths) {
      const source = await readFile(workflowPath, "utf8");
      expect(source).toContain("--project=deep");
      expect(source).toContain("--project=mobile");
      expect(source).not.toContain("--last-failed");
      expect(source).not.toContain("pnpm build");
      expect(source).not.toContain("pnpm start");
      expect(source).toContain("X-Formoria-Revision");
    }
  });

  it("has nightly/manual/release-only triggers", async () => {
    const nightly = parseYaml(await readFile(workflowPaths[0], "utf8")) as { on: Record<string, unknown> };
    const manual = parseYaml(await readFile(workflowPaths[1], "utf8")) as { on: Record<string, unknown> };
    const releaseSource = await readFile(workflowPaths[2], "utf8");
    const release = parseYaml(releaseSource) as { on: Record<string, unknown> };
    expect(nightly.on.schedule).toBeTruthy();
    expect(nightly.on.workflow_dispatch).toBeTruthy();
    expect(manual.on.workflow_dispatch).toBeTruthy();
    expect(release.on.pull_request).toBeTruthy();
    expect(JSON.stringify(release.on.pull_request)).toContain("main");
    expect(releaseSource).toContain("group: formoria-staging-e2e");
  });
});
