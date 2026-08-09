import { describe, expect, it, vi } from "vitest";
import type { AuditRecord } from "../health-agent/contracts";
import {
  e2eSlackWebhookUrl,
  parsePlaywrightReport,
  playwrightStatsFromEnvironment,
  readPlaywrightReport,
  renderE2ESlackNotification,
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

  it("parses nested failed specs and falls back for malformed or missing reports", async () => {
    expect(
      parsePlaywrightReport({
        stats: { expected: 8, flaky: 1, skipped: 2, unexpected: 2 },
        suites: [
          {
            file: "e2e/tests/search.spec.ts",
            specs: [
              {
                ok: false,
                title: "searches by category",
                tests: [{ projectName: "deep" }],
              },
            ],
            suites: [
              {
                specs: [
                  {
                    ok: false,
                    title: "keeps the selected filter",
                    tests: [{ projectName: "mobile" }],
                  },
                ],
              },
            ],
          },
        ],
      }),
    ).toEqual({
      failedSpecs: [
        {
          file: "e2e/tests/search.spec.ts",
          project: "deep",
          title: "searches by category",
        },
        {
          file: "e2e/tests/search.spec.ts",
          project: "mobile",
          title: "keeps the selected filter",
        },
      ],
      reportAvailable: true,
      stats: { failed: 2, passed: 9, skipped: 2 },
    });
    expect(parsePlaywrightReport("malformed")).toEqual({
      failedSpecs: [],
      reportAvailable: false,
      stats: { failed: 0, passed: 0, skipped: 0 },
    });
    expect(parsePlaywrightReport({ stats: "malformed" })).toEqual({
      failedSpecs: [],
      reportAvailable: false,
      stats: { failed: 0, passed: 0, skipped: 0 },
    });
    await expect(
      readPlaywrightReport("/tmp/formoria-missing-playwright-report.json"),
    ).resolves.toMatchObject({
      failedSpecs: [],
      reportAvailable: false,
      stats: { failed: 0, passed: 0, skipped: 0 },
    });
  });

  it("formats the exact initial-red message", () => {
    expect(
      renderE2ESlackNotification({
        failed: 2,
        failedSpecs: [
          {
            file: "e2e/tests/search.spec.ts",
            title: "searches by category",
          },
        ],
        passed: 8,
        phase: "initial",
        reportAvailable: true,
        runAttempt: "1",
        runId: "42",
        skipped: 1,
        status: "failure",
        workflowUrl: "https://github.com/ytchou/Formoria/actions/runs/42",
      }),
    ).toBe(
      [
        "⚠️ *Formoria E2E — Needs attention*",
        "*Summary*\n• 8 passed · 2 failed · 1 skipped",
        "*Failed specs*\n• e2e/tests/search.spec.ts — searches by category",
        "<https://github.com/ytchou/Formoria/actions/runs/42|Open workflow run>",
      ].join("\n\n"),
    );
  });

  it("formats the exact initial-green message", () => {
    expect(
      renderE2ESlackNotification({
        failed: 0,
        passed: 12,
        phase: "initial",
        reportAvailable: true,
        runAttempt: "1",
        runId: "46",
        skipped: 0,
        status: "success",
        workflowUrl: "https://github.com/ytchou/Formoria/actions/runs/46",
      }),
    ).toBe(
      [
        "✅ *Formoria E2E — Success*",
        "*Summary*\n• 12 passed · 0 failed · 0 skipped",
        "<https://github.com/ytchou/Formoria/actions/runs/46|Open workflow run>",
      ].join("\n\n"),
    );
  });

  it("formats the exact terminal-ready message", () => {
    expect(
      renderE2ESlackNotification({
        failed: 0,
        passed: 10,
        phase: "ready",
        prUrl: "https://github.com/ytchou/Formoria/pull/99",
        reportAvailable: true,
        runAttempt: "1",
        runId: "43",
        skipped: 0,
        status: "success",
        workflowUrl: "https://github.com/ytchou/Formoria/actions/runs/43",
      }),
    ).toBe(
      [
        "✅ *Formoria E2E — Success*",
        "*Summary*\n• 10 passed · 0 failed · 0 skipped",
        "*Repair PR*\n<https://github.com/ytchou/Formoria/pull/99|Open PR>",
        "<https://github.com/ytchou/Formoria/actions/runs/43|Open workflow run>",
      ].join("\n\n"),
    );
  });

  it("formats the exact terminal-blocked message with remaining specs", () => {
    expect(
      renderE2ESlackNotification({
        failed: 0,
        failedSpecs: [
          {
            file: "e2e/tests/search.spec.ts",
            title: "searches by category",
          },
          {
            file: "e2e/tests/mobile.spec.ts",
            title: "keeps the selected filter",
          },
        ],
        passed: 0,
        phase: "blocked",
        prUrl: "https://github.com/ytchou/Formoria/pull/100",
        reportAvailable: false,
        reason: "repair cycle 2 ended red",
        runAttempt: "2",
        runId: "44",
        skipped: 0,
        status: "failure",
        workflowUrl: "https://github.com/ytchou/Formoria/actions/runs/44",
      }),
    ).toBe(
      [
        "❌ *Formoria E2E — Failed*",
        "*Summary*\n• 2 remaining failed specs",
        "*Failed specs*\n• e2e/tests/search.spec.ts — searches by category\n• e2e/tests/mobile.spec.ts — keeps the selected filter",
        "*Blocked draft PR*\n<https://github.com/ytchou/Formoria/pull/100|Open PR>",
        "<https://github.com/ytchou/Formoria/actions/runs/44|Open workflow run>",
      ].join("\n\n"),
    );
  });

  it("keeps the source failure count when guard skip has no downloaded report", () => {
    expect(
      renderE2ESlackNotification({
        failed: 3,
        passed: 0,
        phase: "blocked",
        reportAvailable: false,
        runAttempt: "1",
        runId: "47",
        skipped: 0,
        status: "failure",
        workflowUrl: "https://github.com/ytchou/Formoria/actions/runs/47",
      }),
    ).toBe(
      [
        "❌ *Formoria E2E — Failed*",
        "*Summary*\n• 3 remaining failed specs",
        "<https://github.com/ytchou/Formoria/actions/runs/47|Open workflow run>",
      ].join("\n\n"),
    );
  });

  it("sends the same initial-red message through the Slack adapter", async () => {
    const records: AuditRecord[] = [];
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("ok", { status: 200 }));

    await sendE2ESlackNotification(
      {
        failed: 2,
        failedSpecs: [
          {
            file: "e2e/tests/search.spec.ts",
            title: "searches by category",
          },
        ],
        passed: 8,
        phase: "initial",
        reportAvailable: true,
        runAttempt: "1",
        runId: "42",
        selfHealEnabled: true,
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
        "*Failed specs*\n• e2e/tests/search.spec.ts — searches by category",
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

  it("sends the same terminal-ready message through the Slack adapter", async () => {
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
        reportAvailable: true,
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
        "*Repair PR*\n<https://github.com/ytchou/Formoria/pull/99|Open PR>",
        "<https://github.com/ytchou/Formoria/actions/runs/43|Open workflow run>",
      ].join("\n\n"),
    );
    expect(body.text).not.toContain("Auto-merge");
  });

  it("sends the same terminal-blocked message through the Slack adapter", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("ok", { status: 200 }));

    await sendE2ESlackNotification(
      {
        failed: 2,
        failedSpecs: [
          {
            file: "e2e/tests/search.spec.ts",
            title: "searches by category",
          },
        ],
        passed: 8,
        phase: "blocked",
        prUrl: "https://github.com/ytchou/Formoria/pull/100",
        reportAvailable: false,
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
        "*Summary*\n• 1 remaining failed specs",
        "*Failed specs*\n• e2e/tests/search.spec.ts — searches by category",
        "*Blocked draft PR*\n<https://github.com/ytchou/Formoria/pull/100|Open PR>",
        "<https://github.com/ytchou/Formoria/actions/runs/44|Open workflow run>",
      ].join("\n\n"),
    );
  });
});
