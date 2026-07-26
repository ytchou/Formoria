import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("health confirmation workflow contract", () => {
  async function workflow(): Promise<string> {
    const [controller, publish] = await Promise.all([
      readFile(".github/workflows/health-agent.yml", "utf8"),
      readFile(".github/workflows/health-agent-publish.yml", "utf8"),
    ]);
    return `${controller}\n${publish}`;
  }

  it("subscribes only to closed health PRs and deployment status events", async () => {
    const combined = await workflow();

    expect(combined).toContain("pull_request:\n    types: [closed]");
    expect(combined).toContain("deployment_status:");
    expect(combined).toContain(
      "contains(github.event.pull_request.labels.*.name, 'health-agent')",
    );
    expect(combined).toContain("vars.HEALTH_AGENT_ENABLED == 'true'");
    expect(combined).toContain(
      "contains(github.event.pull_request.labels.*.name, 'health-agent-canary')",
    );
    expect(combined).toContain("github.event_name == 'deployment_status'");
    expect(combined).toContain(
      "github.event.pull_request.number || github.event.deployment.sha",
    );
  });

  it("uses least privilege and scoped health credentials", async () => {
    const [controller, combined] = await Promise.all([
      readFile(".github/workflows/health-agent.yml", "utf8"),
      workflow(),
    ]);

    expect(combined).toContain("contents: read");
    expect(combined).toContain("deployments: read");
    expect(controller).toContain(
      "permissions:\n  contents: read\n  deployments: read",
    );
    expect(combined).toContain("pull-requests: read");
    expect(combined).toContain("persist-credentials: false");
    expect(combined).toContain("HEALTH_AGENT_READER_TOKEN");
    expect(combined).toContain("HEALTH_AGENT_WRITER_TOKEN");
    expect(combined).toContain("SENTRY_RESOLVER_TOKEN");
    expect(combined).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(combined).not.toContain("CLAUDE_CODE_OAUTH_TOKEN");
    expect(combined).not.toContain("anthropics/");
    expect(combined).not.toContain("contents: write");
  });

  it("runs the validated confirmation module and always retains redacted audit evidence", async () => {
    const combined = await workflow();

    expect(combined).toContain(
      "pnpm exec tsx scripts/health-agent/confirmation.ts",
    );
    expect(combined).toContain("always() &&");
    expect(combined).toContain(
      "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
    );
    for (const [, ref] of combined.matchAll(/uses:\s+[^\s]+@([^\s#]+)/g)) {
      expect(ref).toMatch(/^[0-9a-f]{40}$/);
    }
    expect(combined).toContain("confirmation-audit.json");
    expect(combined).toContain("retention-days: 14");
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
