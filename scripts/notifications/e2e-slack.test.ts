import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuditRecord } from "../health-agent/contracts";
import {
  e2eSlackWebhookUrl,
  parsePlaywrightReport,
  playwrightStatsFromEnvironment,
  readPlaywrightReport,
  renderE2ESlackNotification,
  sendE2ESlackNotification,
  taipeiRunDate,
} from "./e2e-slack";

describe("E2E Slack notifications", () => {
  // Titles carry the run date, so the exact-message assertions below need a
  // fixed clock. Only `Date` is faked — timers stay real so the async send
  // tests are unaffected. 22:30 UTC is deliberate: it is already the next day
  // in Asia/Taipei, which is the case the nightly's 22:10 UTC start hits.
  beforeAll(() => {
    vi.useFakeTimers({
      now: new Date("2026-08-10T22:30:00Z"),
      toFake: ["Date"],
    });
  });
  afterAll(() => {
    vi.useRealTimers();
  });

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
        "⚠️ *Formoria E2E — Needs attention* · 2026-08-11",
        "*Summary*\n• 8 passed · 2 failed · 1 skipped",
        "*Failed specs*\n• e2e/tests/search.spec.ts — searches by category",
        "<https://github.com/ytchou/Formoria/actions/runs/42|Open workflow run>",
      ].join("\n\n"),
    );
  });

  it("reports the root incident when batch diagnosis starts", () => {
    const message = renderE2ESlackNotification({
      failed: 3,
      passed: 42,
      phase: "initial",
      rootIncidentId: "nightly-991",
      runAttempt: "1",
      runId: "991",
      selfHealEnabled: true,
      skipped: 1,
      status: "failure",
      workflowUrl: "https://github.test/actions/991",
    });
    expect(message).toContain("• Root incident: nightly-991");
    expect(message).toContain("• Batch diagnosis started");
  });

  it.each([
    ["merged", "Success"],
    ["review_ready", "Success"],
    ["recovered_no_change", "Success"],
    ["infrastructure_blocked", "Failed"],
    ["repair_blocked", "Failed"],
  ] as const)("renders the %s terminal outcome", (phase, title) => {
    const message = renderE2ESlackNotification({
      cyclesUsed: 2,
      exactGate: phase.includes("blocked") ? "failed" : "passed",
      failed: phase.includes("blocked") ? 2 : 0,
      fullGate: phase.includes("blocked") ? "not-run" : "passed",
      passed: phase.includes("blocked") ? 0 : 54,
      phase,
      prUrl:
        phase === "merged" || phase === "review_ready"
          ? "https://github.test/pull/77"
          : undefined,
      reportAvailable: true,
      rootIncidentId: "nightly-991",
      runAttempt: "1",
      runId: "993",
      skipped: 1,
      status: phase.includes("blocked") ? "failure" : "success",
      workflowUrl: "https://github.test/actions/993",
    });
    expect(message).toContain(`Formoria E2E — ${title}`);
    expect(message).toContain("• Repair cycles: 2/3");
    expect(message).toContain("• Exact-set gate:");
    expect(message).toContain("• Full-suite gate:");
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
        "✅ *Formoria E2E — Success* · 2026-08-11",
        "*Summary*\n• 12 passed · 0 failed · 0 skipped",
        "<https://github.com/ytchou/Formoria/actions/runs/46|Open workflow run>",
      ].join("\n\n"),
    );
  });

  it("names the monitor and its probed origin when a label is supplied", () => {
    expect(
      renderE2ESlackNotification({
        failed: 0,
        label: "E2E Production (Synthetic)",
        passed: 4,
        phase: "initial",
        reportAvailable: true,
        runAttempt: "1",
        runId: "47",
        scope: "Signup + confirmation-email delivery on the live deployment",
        skipped: 1,
        status: "success",
        target: "https://formoria.com",
        workflowUrl: "https://github.com/ytchou/Formoria/actions/runs/47",
      }),
    ).toBe(
      [
        "✅ *Formoria E2E Production (Synthetic) — Success* · 2026-08-11",
        "*Summary*\n• Scope: Signup + confirmation-email delivery on the live deployment\n• 4 passed · 0 failed · 1 skipped\n• Target: https://formoria.com",
        "<https://github.com/ytchou/Formoria/actions/runs/47|Open workflow run>",
      ].join("\n\n"),
    );
  });

  it("dates the title in Asia/Taipei and prefers an explicit run date", () => {
    // 22:30 UTC is already the next day in Taipei — the nightly's own window.
    expect(taipeiRunDate(new Date("2026-08-10T22:30:00Z"))).toBe("2026-08-11");
    expect(taipeiRunDate(new Date("2026-08-10T15:59:00Z"))).toBe("2026-08-10");
    expect(
      renderE2ESlackNotification({
        date: "2026-08-09",
        failed: 0,
        passed: 4,
        phase: "initial",
        reportAvailable: true,
        runAttempt: "1",
        runId: "48",
        skipped: 0,
        status: "success",
        workflowUrl: "https://github.com/ytchou/Formoria/actions/runs/48",
      }),
    ).toContain("✅ *Formoria E2E — Success* · 2026-08-09");
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
        "✅ *Formoria E2E — Success* · 2026-08-11",
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
        "❌ *Formoria E2E — Failed* · 2026-08-11",
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
        "❌ *Formoria E2E — Failed* · 2026-08-11",
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
        "⚠️ *Formoria E2E — Needs attention* · 2026-08-11",
        "*Summary*\n• 8 passed · 2 failed · 1 skipped\n• Batch diagnosis started",
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
        "✅ *Formoria E2E — Success* · 2026-08-11",
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
        "❌ *Formoria E2E — Failed* · 2026-08-11",
        "*Summary*\n• 1 remaining failed specs",
        "*Failed specs*\n• e2e/tests/search.spec.ts — searches by category",
        "*Blocked draft PR*\n<https://github.com/ytchou/Formoria/pull/100|Open PR>",
        "<https://github.com/ytchou/Formoria/actions/runs/44|Open workflow run>",
      ].join("\n\n"),
    );
  });
});
