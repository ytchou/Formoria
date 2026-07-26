import { describe, expect, it, vi } from "vitest";
import type { AuditRecord } from "../health-agent/contracts";
import {
  e2eSlackWebhookUrl,
  playwrightStatsFromEnvironment,
  sendE2ESlackNotification,
} from "./e2e-slack";

describe("E2E Slack notifications", () => {
  it("requires the Formoria-owned webhook instead of the shared health webhook", () => {
    expect(
      e2eSlackWebhookUrl({
        SLACK_FORMORIA_WEBHOOK_URL: "https://hooks.slack.test/formoria",
      }),
    ).toBe("https://hooks.slack.test/formoria");
    expect(() =>
      e2eSlackWebhookUrl({
        SLACK_HEALTH_WEBHOOK_URL: "https://hooks.slack.test/os-agents",
      }),
    ).toThrow("SLACK_FORMORIA_WEBHOOK_URL is required");
  });

  it("falls back to report counts when terminal count overrides are absent", () => {
    expect(
      playwrightStatsFromEnvironment({ failed: 2, passed: 8, skipped: 1 }, {}),
    ).toEqual({ failed: 2, passed: 8, skipped: 1 });
    expect(
      playwrightStatsFromEnvironment(
        { failed: 0, passed: 0, skipped: 0 },
        { E2E_FAILED: "1", E2E_PASSED: "9", E2E_SKIPPED: "2" },
      ),
    ).toEqual({ failed: 1, passed: 9, skipped: 2 });
  });

  it("reports the first E2E result as a direct Formoria message", async () => {
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
    expect(body.text).toBe(
      [
        "⚠️ *Formoria E2E — Needs attention*",
        "*Summary*\n• 8 passed · 2 failed · 1 skipped",
        "*Work done*\n• Repair in progress",
        "*Manager action*\n• No action while self-heal runs",
        "*Details*\n• Self-heal started",
        "<https://github.com/ytchou/Formoria/actions/runs/42|Open workflow run>",
      ].join("\n\n"),
    );
    expect(body.text).not.toContain("health agent summary");
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      adapter: "slack",
      operation: "send_message",
      status: "success",
    });
  });

  it("shares the review-ready self-heal PR without promising auto-merge", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("ok", { status: 200 }));

    await sendE2ESlackNotification(
      {
        failed: 0,
        passed: 10,
        phase: "ready",
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
    expect(body.text).toBe(
      [
        "✅ *Formoria E2E — Success*",
        "*Summary*\n• 10 passed · 0 failed · 0 skipped",
        "*Work done*\n• Repair PR: <https://github.com/ytchou/Formoria/pull/99|Open PR>",
        "*Manager action*\n• Review and merge the repair PR",
        "*Details*\n• Self-heal validation is green\n• Automatic merge is disabled",
        "<https://github.com/ytchou/Formoria/actions/runs/43|Open workflow run>",
      ].join("\n\n"),
    );
    expect(body.text).not.toContain("Auto-merge");
  });

  it("reports a terminal self-heal block with no PR", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("ok", { status: 200 }));

    await sendE2ESlackNotification(
      {
        failed: 2,
        passed: 8,
        phase: "blocked",
        reason: "review rejected the proposed fix",
        runAttempt: "2",
        runId: "44",
        skipped: 1,
        status: "failure",
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
    expect(body.text).toBe(
      [
        "❌ *Formoria E2E — Failed*",
        "*Summary*\n• 8 passed · 2 failed · 1 skipped",
        "*Work done*\n• No repair PR created",
        "*Manager action*\n• Investigate why self-heal stopped",
        "*Details*\n• Reason: review rejected the proposed fix",
        "<https://github.com/ytchou/Formoria/actions/runs/44|Open workflow run>",
      ].join("\n\n"),
    );
  });
});
