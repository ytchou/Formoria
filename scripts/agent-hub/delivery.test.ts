import { describe, expect, it } from "vitest";

import { AgentHubDeliveryError, createAgentHubDelivery } from "./delivery.mjs";

function envelope(overrides: Record<string, unknown> = {}) {
  return {
    data: { scorecard: { sessions: 42 } },
    date: "2026-07-15",
    project: "formoria",
    routine: "health-agent",
    run_at: "2026-07-14T23:10:00.000Z",
    source: "github_actions",
    source_run_id: "github-actions:health-agent:123:1",
    status: "success",
    tickets_created: [],
    verdict_severity: "ok",
    verdict_text: "Health is steady.",
    version: 1,
    ...overrides,
  };
}

describe("Agent Hub Turso delivery", () => {
  it("delivers one normalized envelope to Turso and returns its result", async () => {
    const received: unknown[] = [];
    const writer = async (value: unknown) => {
      received.push(value);
      return { duplicate: false, run_id: "turso-run" };
    };
    const delivery = createAgentHubDelivery({
      env: {},
      tursoWriter: writer,
    });

    const result = await delivery(envelope());

    expect(received).toHaveLength(1);
    expect((received[0] as Record<string, unknown>).source_run_id).toBe(
      "github-actions:health-agent:123:1",
    );
    expect(result).toEqual({ duplicate: false, run_id: "turso-run" });
  });

  it("rejects a Turso result with a different source_run_id", async () => {
    const delivery = createAgentHubDelivery({
      env: {},
      tursoWriter: async () => ({
        duplicate: false,
        run_id: "turso-run",
        source_run_id: "wrong-source-run",
      }),
    });

    await expect(delivery(envelope())).rejects.toMatchObject({
      failures: ["turso"],
    });
  });

  it("reports Turso delivery failures and audits the failed destination", async () => {
    const records: unknown[] = [];
    const delivery = createAgentHubDelivery({
      env: {},
      logger: (record: unknown) => records.push(record),
      tursoWriter: async () => {
        throw new Error("Turso is unavailable");
      },
    });

    await expect(delivery(envelope())).rejects.toBeInstanceOf(
      AgentHubDeliveryError,
    );
    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          destination: "turso",
          status: "failure",
        }),
      ]),
    );
  });

  it("redacts Turso failures before they reach the audit logger", async () => {
    const secret = "turso-window-secret";
    const records: unknown[] = [];
    const delivery = createAgentHubDelivery({
      env: {},
      logger: (record: unknown) => records.push(record),
      secrets: [secret],
      tursoWriter: async () => {
        throw new Error("authorization=" + secret);
      },
    });

    await expect(delivery(envelope())).rejects.toBeInstanceOf(
      AgentHubDeliveryError,
    );
    expect(JSON.stringify(records)).not.toContain(secret);
    expect(JSON.stringify(records)).toContain("[REDACTED]");
  });
});
