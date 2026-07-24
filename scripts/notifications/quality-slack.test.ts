import { describe, expect, it, vi } from "vitest";
import type { AuditRecord } from "../health-agent/contracts";
import { sendQualitySlackNotification } from "./quality-slack";

describe("Quality Slack notifications", () => {
  it("reports initial failure with check names", async () => {
    const records: AuditRecord[] = [];
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("ok", { status: 200 }));

    await sendQualitySlackNotification(
      {
        deadCodeResult: "success",
        phase: "initial",
        runAttempt: "1",
        runId: "42",
        unitCoverageResult: "failure",
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
    expect(body.text).toContain("*Failures*");
    expect(body.text).toContain("Quality nightly");
    expect(body.text).toContain("unit-coverage: FAILED");
    expect(body.text).toContain("dead-code: passed");
    expect(body.text).toContain("actions/runs/42");
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      adapter: "slack",
      operation: "send_message",
      status: "success",
    });
  });

  it("reports all-clear when both pass", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("ok", { status: 200 }));

    await sendQualitySlackNotification(
      {
        deadCodeResult: "success",
        phase: "initial",
        runAttempt: "1",
        runId: "43",
        unitCoverageResult: "success",
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
    expect(body.text).toContain("*Skipped actions*");
    expect(body.text).not.toContain("*Failures*");
    expect(body.text).toContain("all clear");
    expect(body.text).toContain("unit-coverage: passed");
    expect(body.text).toContain("dead-code: passed");
  });

  it("reports green self-heal with PR URL", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("ok", { status: 200 }));

    await sendQualitySlackNotification(
      {
        autoMergeEnabled: true,
        deadCodeResult: "success",
        phase: "green",
        prUrl: "https://github.com/ytchou/Formoria/pull/99",
        runAttempt: "1",
        runId: "44",
        unitCoverageResult: "success",
        workflowUrl: "https://github.com/ytchou/Formoria/actions/runs/44",
      },
      {
        fetchImpl,
        webhookUrl: "https://hooks.slack.test/webhook",
      },
    );

    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)) as {
      text: string;
    };
    expect(body.text).toContain("*PR outcomes*");
    expect(body.text).toContain("Self-heal green");
    expect(body.text).toContain("pull/99");
    expect(body.text).toContain("Auto-merge enabled");
  });
});
