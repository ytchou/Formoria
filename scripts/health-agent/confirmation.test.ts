import { describe, expect, it, vi } from "vitest";

import {
  confirmHealthEvent,
  HEALTH_PR_LABEL,
  HEALTH_PR_MARKER,
  parseConfirmationEvent,
  type ConfirmationDependencies,
  type HealthFixRow,
} from "./confirmation";

const mergeSha = "a".repeat(40);
const wrongSha = "b".repeat(40);
const now = new Date("2026-07-22T02:00:00.000Z");

function row(overrides: Partial<HealthFixRow> = {}): HealthFixRow {
  return {
    evidence: { route: "/brands" },
    fingerprint: "sentry:application:brands-route",
    id: "5cf0f5cd-3025-4c0d-8aab-691088c694db",
    merge_policy: "automatic",
    merge_sha: null,
    pr_number: 42,
    sentry_issue_id: "12345",
    source: "sentry",
    status: "pr_opened",
    title: "Brands route crashes",
    ...overrides,
  };
}

function dependencies() {
  const transition = vi.fn<ConfirmationDependencies["transition"]>(
    async (input) =>
      row({
        id: input.id,
        merge_sha: input.mergeSha ?? null,
        status: input.newStatus,
      }),
  );
  const deps: ConfirmationDependencies = {
    agentHub: vi.fn(async () => ({ duplicate: false, run_id: "run-1" })),
    linear: vi.fn(async () => ({ tickets: ["DEV-123"] })),
    resolveSentry: vi.fn(async (ids) => ids.length),
    slack: vi.fn(async () => 1),
    smoke: vi.fn<ConfirmationDependencies["smoke"]>(async () => ({
      body: { status: "ok" },
      checkedAt: "2026-07-22T02:05:00.000Z",
      httpStatus: 200,
      url: "https://formoria.test/api/health",
    })),
    transition,
  };
  return deps;
}

function pullRequestPayload(overrides: Record<string, unknown> = {}) {
  return {
    action: "closed",
    pull_request: {
      auto_merge: { enabled_by: { login: "health-agent[bot]" } },
      body: HEALTH_PR_MARKER,
      html_url: "https://github.test/formoria/pull/42",
      labels: [{ name: HEALTH_PR_LABEL }],
      merge_commit_sha: mergeSha,
      merged: true,
      number: 42,
      ...overrides,
    },
  };
}

function deploymentEvent(
  overrides: Partial<{
    creator: string;
    environment: string;
    sha: string;
    state: string;
  }> = {},
) {
  return parseConfirmationEvent("deployment_status", {
    deployment: {
      creator: { login: overrides.creator ?? "railway-app[bot]" },
      environment: overrides.environment ?? "Formoria / production",
      sha: overrides.sha ?? mergeSha,
    },
    deployment_status: {
      environment_url: "https://formoria.test",
      state: overrides.state ?? "success",
    },
  });
}

describe("confirmation event validation", () => {
  it("requires both the stable label and exact metadata marker", () => {
    expect(
      parseConfirmationEvent(
        "pull_request",
        pullRequestPayload({ labels: [{ name: "bug" }] }),
      ),
    ).toBeNull();
    expect(
      parseConfirmationEvent(
        "pull_request",
        pullRequestPayload({ body: `${HEALTH_PR_MARKER} forged-suffix` }),
      ),
    ).toBeNull();
    expect(
      parseConfirmationEvent(
        "pull_request",
        pullRequestPayload({
          body: `${HEALTH_PR_MARKER}\n\n## Findings\n- traced finding`,
        }),
      ),
    ).toMatchObject({
      kind: "pull_request_closed",
      mergeSha,
      merged: true,
      number: 42,
    });
  });

  it("accepts only an actual closed event and ignores auto-merge metadata", () => {
    expect(
      parseConfirmationEvent("pull_request", {
        ...pullRequestPayload(),
        action: "opened",
      }),
    ).toBeNull();
    expect(
      parseConfirmationEvent(
        "pull_request",
        pullRequestPayload({
          auto_merge: { enabled_by: { login: "health-agent[bot]" } },
          merge_commit_sha: null,
          merged: false,
        }),
      ),
    ).toMatchObject({ mergeSha: null, merged: false });
  });
});

describe("pull request confirmation", () => {
  it("marks closed-unmerged findings needs_human, opens durable Linear work, and never resolves Sentry", async () => {
    const deps = dependencies();
    const event = parseConfirmationEvent(
      "pull_request",
      pullRequestPayload({ merge_commit_sha: null, merged: false }),
    );

    const result = await confirmHealthEvent({
      dependencies: deps,
      event,
      now,
      rows: [row(), row({ id: "870bea95-8bcf-4825-a7df-460c31d642f8" })],
      sourceRunId: "github-actions:confirmation:500:1",
    });

    expect(result).toMatchObject({
      action: "closed_unmerged",
      findingCount: 2,
      linear: "sent",
      sentryResolved: 0,
    });
    expect(deps.transition).toHaveBeenCalledTimes(2);
    expect(deps.transition).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedStatus: "pr_opened",
        newStatus: "needs_human",
      }),
    );
    expect(deps.linear).toHaveBeenCalledTimes(1);
    expect(deps.resolveSentry).not.toHaveBeenCalled();
  });

  it("records only GitHub's authoritative merge_commit_sha as merged", async () => {
    const deps = dependencies();
    const event = parseConfirmationEvent("pull_request", pullRequestPayload());

    const result = await confirmHealthEvent({
      dependencies: deps,
      event,
      now,
      rows: [row({ status: "awaiting_human" })],
      sourceRunId: "github-actions:confirmation:501:1",
    });

    expect(result.action).toBe("merged_recorded");
    expect(deps.transition).toHaveBeenCalledWith({
      expectedStatus: "awaiting_human",
      id: expect.any(String),
      mergeSha,
      newStatus: "merged",
      prNumber: 42,
      prUrl: "https://github.test/formoria/pull/42",
    });
    expect(deps.smoke).not.toHaveBeenCalled();
    expect(deps.resolveSentry).not.toHaveBeenCalled();
  });
});

describe("Railway deployment confirmation", () => {
  it("does not advance untrusted, non-production, or in-progress deployments", async () => {
    for (const event of [
      deploymentEvent({ creator: "attacker[bot]" }),
      deploymentEvent({ environment: "Formoria / preview" }),
      deploymentEvent({ state: "in_progress" }),
    ]) {
      const deps = dependencies();
      const result = await confirmHealthEvent({
        dependencies: deps,
        event,
        now,
        rows: [row({ merge_sha: mergeSha, status: "merged" })],
        sourceRunId: "github-actions:confirmation:502:1",
      });
      expect(result.status).toBe("skipped");
      expect(deps.transition).not.toHaveBeenCalled();
      expect(deps.resolveSentry).not.toHaveBeenCalled();
    }
  });

  it("rejects a successful deployment whose SHA does not exactly match stored merge_sha", async () => {
    const deps = dependencies();
    const result = await confirmHealthEvent({
      dependencies: deps,
      event: deploymentEvent({ sha: wrongSha }),
      now,
      rows: [row({ merge_sha: mergeSha, status: "merged" })],
      sourceRunId: "github-actions:confirmation:503:1",
    });

    expect(result).toMatchObject({ action: "wrong_sha", status: "failed" });
    expect(deps.smoke).not.toHaveBeenCalled();
    expect(deps.transition).not.toHaveBeenCalled();
    expect(deps.resolveSentry).not.toHaveBeenCalled();
  });

  it("retains unresolved findings and alerts when deployment or smoke fails", async () => {
    const failedDeploymentDeps = dependencies();
    const failedDeployment = await confirmHealthEvent({
      dependencies: failedDeploymentDeps,
      event: deploymentEvent({ state: "failure" }),
      now,
      rows: [row({ merge_sha: mergeSha, status: "merged" })],
      sourceRunId: "github-actions:confirmation:504:1",
    });
    expect(failedDeployment.action).toBe("deployment_failed");
    expect(failedDeploymentDeps.transition).not.toHaveBeenCalled();
    expect(failedDeploymentDeps.resolveSentry).not.toHaveBeenCalled();
    expect(failedDeploymentDeps.slack).toHaveBeenCalledTimes(1);

    const smokeDeps = dependencies();
    vi.mocked(smokeDeps.smoke).mockRejectedValueOnce(new Error("unhealthy"));
    const smokeFailure = await confirmHealthEvent({
      dependencies: smokeDeps,
      event: deploymentEvent(),
      now,
      rows: [row({ merge_sha: mergeSha, status: "merged" })],
      sourceRunId: "github-actions:confirmation:505:1",
    });
    expect(smokeFailure.action).toBe("smoke_failed");
    expect(smokeDeps.transition).not.toHaveBeenCalled();
    expect(smokeDeps.resolveSentry).not.toHaveBeenCalled();
  });

  it("resolves Sentry only after exact deployment, healthy smoke, deployed, and fixed transitions", async () => {
    const deps = dependencies();
    const order: string[] = [];
    vi.mocked(deps.transition).mockImplementation(async (input) => {
      order.push(`transition:${input.newStatus}`);
      return row({
        id: input.id,
        merge_sha: mergeSha,
        status: input.newStatus,
      });
    });
    vi.mocked(deps.resolveSentry).mockImplementation(async () => {
      order.push("sentry:resolve");
      return 1;
    });

    const result = await confirmHealthEvent({
      dependencies: deps,
      event: deploymentEvent(),
      now,
      rows: [row({ merge_sha: mergeSha, status: "merged" })],
      sourceRunId: "github-actions:confirmation:506:1",
    });

    expect(result).toMatchObject({
      action: "deployment_confirmed",
      sentryResolved: 1,
      status: "success",
    });
    expect(order).toEqual([
      "transition:deployed",
      "transition:fixed",
      "sentry:resolve",
    ]);
    expect(deps.transition).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        confirmationData: expect.objectContaining({
          deployment_sha: mergeSha,
          health_status: "ok",
          http_status: 200,
        }),
        deployedAt: "2026-07-22T02:05:00.000Z",
        expectedStatus: "merged",
        newStatus: "deployed",
      }),
    );
    expect(deps.transition).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        expectedStatus: "deployed",
        newStatus: "fixed",
      }),
    );
    expect(deps.agentHub).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          authoritative_merge_sha: mergeSha,
          confirmed_fixed_count: 1,
          deployment_status: "success",
          deployment_timestamp: now.toISOString(),
          production_smoke: true,
        }),
        routine: "health-selfheal",
      }),
    );
  });

  it("attempts Slack and Agent Hub independently", async () => {
    const deps = dependencies();
    vi.mocked(deps.slack).mockRejectedValueOnce(new Error("Slack unavailable"));

    const result = await confirmHealthEvent({
      dependencies: deps,
      event: deploymentEvent({ state: "failure" }),
      now,
      rows: [row({ merge_sha: mergeSha, status: "merged" })],
      sourceRunId: "github-actions:confirmation:507:1",
    });

    expect(result.delivery).toEqual({ agentHub: "sent", slack: "failed" });
    expect(deps.slack).toHaveBeenCalledTimes(1);
    expect(deps.agentHub).toHaveBeenCalledTimes(1);
    expect(deps.agentHub).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          deployment_status: "failure",
        }),
        routine: "health-selfheal",
      }),
    );
  });
});
