import { describe, expect, it, vi } from "vitest";
import type { AuditRecord } from "../health-agent/contracts";
import { sendE2ESlackNotification } from "./e2e-slack";

describe("E2E Slack notifications", () => {
  it("reports the first E2E result through the shared Slack adapter", async () => {
    const records: AuditRecord[] = [];
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("ok", { status: 200 }));

    await sendE2ESlackNotification(
      {
        failed: 2,
        passed: 8,
        phase: "initial",
        runAttempt: "1",
        runId: "42",
        skipped: 1,
        status: "failure",
        workflowUrl: "https://github.com/ytchou/Formoria/actions/runs/42",
      },
      {
        audit: (record) => records.push(record),
        fetchImpl,
        webhookUrl: "https://hooks.slack.test/services/private-webhook",
      },
    );

    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)) as {
      text: string;
    };
    expect(body.text).toContain("E2E nightly");
    expect(body.text).toContain("2 failed");
    expect(body.text).toContain("actions/runs/42");
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      adapter: "slack",
      operation: "send_message",
      status: "success",
    });
  });

  it("shares the green self-heal PR and merge state", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("ok", { status: 200 }));

    await sendE2ESlackNotification(
      {
        autoMergeEnabled: true,
        failed: 0,
        passed: 10,
        phase: "green",
        prUrl: "https://github.com/ytchou/Formoria/pull/99",
        runAttempt: "1",
        runId: "43",
        skipped: 0,
        status: "success",
        workflowUrl: "https://github.com/ytchou/Formoria/actions/runs/43",
      },
      {
        fetchImpl,
        webhookUrl: "https://hooks.slack.test/webhook",
      },
    );

    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)) as {
      text: string;
    };
    expect(body.text).toContain("Self-heal green");
    expect(body.text).toContain("pull/99");
    expect(body.text).toContain("Auto-merge enabled");
  });
});
