import { describe, expect, it, vi } from "vitest";

import {
  createWatchdogFailureEnvelope,
  deliverWatchdogFailure,
  evaluateHealthFreshness,
  type GitHubWorkflowJob,
  type GitHubWorkflowRun,
} from "./watchdog";

const now = new Date("2026-07-22T00:30:00.000Z");

function run(overrides: Partial<GitHubWorkflowRun> = {}): GitHubWorkflowRun {
  return {
    conclusion: "success",
    created_at: "2026-07-21T23:02:00.000Z",
    html_url: "https://github.test/formoria/actions/runs/42",
    id: 42,
    run_attempt: 1,
    run_started_at: "2026-07-21T23:03:00.000Z",
    status: "completed",
    ...overrides,
  };
}

function aggregateJob(
  overrides: Partial<GitHubWorkflowJob> = {},
): GitHubWorkflowJob {
  return {
    conclusion: "success",
    name: "aggregate-and-deliver",
    status: "completed",
    steps: [
      {
        conclusion: "success",
        name: "Deliver Agent Hub envelopes",
        status: "completed",
      },
    ],
    ...overrides,
  };
}

describe("health freshness evaluation", () => {
  it("reports a deliberately missing or prior-day run as missing", () => {
    expect(evaluateHealthFreshness({ jobs: [], now, runs: [] })).toMatchObject({
      healthy: false,
      logicalDate: "2026-07-22",
      reason: "missing_run",
    });
    expect(
      evaluateHealthFreshness({
        jobs: [aggregateJob()],
        now,
        runs: [
          run({
            created_at: "2026-07-20T23:00:00.000Z",
            id: 41,
            run_started_at: "2026-07-20T23:01:00.000Z",
          }),
        ],
      }),
    ).toMatchObject({ healthy: false, reason: "missing_run" });
  });

  it("does not accept a same-day run outside the 07:00 logical window", () => {
    expect(
      evaluateHealthFreshness({
        jobs: [aggregateJob()],
        now: new Date("2026-07-22T01:00:00.000Z"),
        runs: [
          run({
            id: 43,
            run_started_at: "2026-07-22T00:31:00.000Z",
          }),
        ],
      }),
    ).toMatchObject({ healthy: false, reason: "missing_run" });
  });

  it("reports a cancelled logical run", () => {
    expect(
      evaluateHealthFreshness({
        jobs: [],
        now,
        runs: [run({ conclusion: "cancelled" })],
      }),
    ).toMatchObject({ healthy: false, reason: "run_cancelled" });
  });

  it("reports a run that has not reached successful delivery", () => {
    expect(
      evaluateHealthFreshness({
        jobs: [
          aggregateJob({
            conclusion: null,
            status: "in_progress",
            steps: [
              {
                conclusion: null,
                name: "Deliver Agent Hub envelopes",
                status: "queued",
              },
            ],
          }),
        ],
        now,
        runs: [run({ conclusion: null, status: "in_progress" })],
      }),
    ).toMatchObject({ healthy: false, reason: "delivery_not_successful" });
  });

  it("rejects a completed aggregate job whose delivery step is the only success", () => {
    expect(
      evaluateHealthFreshness({
        jobs: [aggregateJob({ conclusion: "failure" })],
        now,
        runs: [run()],
      }),
    ).toMatchObject({
      healthy: false,
      reason: "aggregate_job_not_successful",
    });
  });

  it("reports missing aggregate jobs and delivery steps", () => {
    expect(
      evaluateHealthFreshness({ jobs: [], now, runs: [run()] }),
    ).toMatchObject({ healthy: false, reason: "aggregate_job_missing" });
    expect(
      evaluateHealthFreshness({
        jobs: [aggregateJob({ steps: [] })],
        now,
        runs: [run()],
      }),
    ).toMatchObject({ healthy: false, reason: "delivery_step_missing" });
  });

  it("accepts only a successful aggregate delivery", () => {
    expect(
      evaluateHealthFreshness({
        jobs: [aggregateJob()],
        now,
        runs: [run()],
      }),
    ).toMatchObject({
      healthy: true,
      logicalDate: "2026-07-22",
      run: { id: 42 },
    });
  });
});

describe("watchdog failure delivery", () => {
  it("builds an Agent Hub v1 envelope owned by GitHub Actions", () => {
    const result = evaluateHealthFreshness({ jobs: [], now, runs: [] });
    if (result.healthy) throw new Error("Expected failure fixture");
    expect(
      createWatchdogFailureEnvelope({
        now,
        result,
        sourceRunId: "github-actions:health-watchdog:900:2",
        workflowUrl: "https://github.test/formoria/actions/runs/900",
      }),
    ).toMatchObject({
      data: {
        notification_owner: "github_actions",
        reason: "missing_run",
        workflow_run_id: null,
      },
      date: "2026-07-22",
      routine: "health-watchdog",
      source: "github_actions",
      source_run_id: "github-actions:health-watchdog:900:2",
      status: "failed",
      version: 1,
    });
  });

  it("attempts Slack and Agent Hub independently when either fails", async () => {
    const result = evaluateHealthFreshness({ jobs: [], now, runs: [] });
    if (result.healthy) throw new Error("Expected failure fixture");
    const envelope = createWatchdogFailureEnvelope({
      now,
      result,
      sourceRunId: "github-actions:health-watchdog:900:1",
    });
    const slack = vi
      .fn<(message: string) => Promise<unknown>>()
      .mockImplementationOnce(() => {
        throw new Error("slack unavailable");
      });
    const agentHub = vi.fn().mockResolvedValue({ run_id: "hub-1" });

    await expect(
      deliverWatchdogFailure(envelope, { agentHub, slack }),
    ).resolves.toEqual({ agentHub: "sent", slack: "failed" });
    expect(slack).toHaveBeenCalledOnce();
    expect(agentHub).toHaveBeenCalledOnce();

    slack.mockResolvedValue(undefined);
    agentHub.mockRejectedValue(new Error("hub unavailable"));
    await expect(
      deliverWatchdogFailure(envelope, { agentHub, slack }),
    ).resolves.toEqual({ agentHub: "failed", slack: "sent" });
    expect(slack).toHaveBeenCalledTimes(2);
    expect(agentHub).toHaveBeenCalledTimes(2);
  });
});
