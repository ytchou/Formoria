import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("health confirmation workflow contract", () => {
  it("subscribes only to closed health PRs and deployment status events", async () => {
    const workflow = await readFile(
      ".github/workflows/health-confirmation.yml",
      "utf8",
    );

    expect(workflow).toContain("pull_request:\n    types: [closed]");
    expect(workflow).toContain("deployment_status:");
    expect(workflow).toContain(
      "contains(github.event.pull_request.labels.*.name, 'health-agent')",
    );
    expect(workflow).toContain("vars.HEALTH_AGENT_ENABLED == 'true'");
    expect(workflow).toContain(
      "contains(github.event.pull_request.labels.*.name, 'health-agent-canary')",
    );
    expect(workflow).toMatch(
      /if: >-\n\s+github\.event_name == 'deployment_status' \|\|/,
    );
    expect(workflow).toContain(
      "github.event.pull_request.number || github.event.deployment.sha",
    );
  });

  it("uses least privilege and scoped health credentials", async () => {
    const workflow = await readFile(
      ".github/workflows/health-confirmation.yml",
      "utf8",
    );

    expect(workflow).toContain("contents: read");
    expect(workflow).toContain("deployments: read");
    expect(workflow).toContain("pull-requests: read");
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).toContain("HEALTH_AGENT_READER_TOKEN");
    expect(workflow).toContain("HEALTH_AGENT_WRITER_TOKEN");
    expect(workflow).toContain("SENTRY_RESOLVER_TOKEN");
    expect(workflow).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(workflow).not.toContain("CLAUDE_CODE_OAUTH_TOKEN");
    expect(workflow).not.toContain("anthropics/");
    expect(workflow).not.toContain("contents: write");
  });

  it("runs the validated confirmation module and always retains redacted audit evidence", async () => {
    const workflow = await readFile(
      ".github/workflows/health-confirmation.yml",
      "utf8",
    );

    expect(workflow).toContain(
      "pnpm exec tsx scripts/health-agent/confirmation.ts",
    );
    expect(workflow).toContain("if: always()");
    expect(workflow).toContain(
      "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02",
    );
    for (const [, ref] of workflow.matchAll(/uses:\s+[^\s]+@([^\s#]+)/g)) {
      expect(ref).toMatch(/^[0-9a-f]{40}$/);
    }
    expect(workflow).toContain("confirmation-audit.json");
    expect(workflow).toContain("retention-days: 14");
  });

  it("enforces Railway identity, exact SHA, smoke, transition, and Sentry timing in code", async () => {
    const implementation = await readFile(
      "scripts/health-agent/confirmation.ts",
      "utf8",
    );

    expect(implementation).toContain('RAILWAY_CREATOR = "railway-app[bot]"');
    expect(implementation).toContain(
      'RAILWAY_PRODUCTION_ENVIRONMENT = "Formoria / production"',
    );
    expect(implementation).toContain('event.state !== "success"');
    expect(implementation).toContain("row.merge_sha === sha");
    expect(implementation).toContain('newStatus: "deployed"');
    expect(implementation).toContain('newStatus: "fixed"');
    expect(implementation).toContain(
      "sentryResolved = await deps.resolveSentry(issueIds)",
    );
    expect(implementation.indexOf('newStatus: "fixed"')).toBeLessThan(
      implementation.indexOf(
        "sentryResolved = await deps.resolveSentry(issueIds)",
      ),
    );
    expect(implementation).toContain('new URL(\n        "/api/health"');
    expect(implementation).toContain('body.status !== "ok"');
  });

  it("mutates queue state only through the writer RPC and attempts deliveries independently", async () => {
    const implementation = await readFile(
      "scripts/health-agent/confirmation.ts",
      "utf8",
    );

    expect(implementation).toContain("/rest/v1/rpc/transition_health_fix");
    expect(implementation).not.toContain('method: "PATCH"');
    expect(implementation).toContain("Promise.allSettled([");
    expect(implementation).toContain("deps.slack(report)");
    expect(implementation).toContain("deps.agentHub(agentHubEnvelope)");
  });
});
