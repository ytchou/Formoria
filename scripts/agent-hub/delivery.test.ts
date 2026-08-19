import { describe, expect, it } from "vitest";

import {
  AgentHubDeliveryConfigurationError,
  AgentHubDeliveryError,
  createAgentHubDelivery,
} from "./delivery.mjs";

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

describe("Agent Hub delivery modes", () => {
  it("delivers one normalized envelope to both destinations concurrently", async () => {
    const received: unknown[] = [];
    let active = 0;
    let maxActive = 0;
    const writer = async (value: unknown) => {
      received.push(value);
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;
      return { duplicate: false, run_id: "run-shared" };
    };

    const delivery = createAgentHubDelivery({
      env: {},
      mode: "dual",
      supabaseWriter: writer,
      tursoWriter: writer,
    });
    const result = await delivery(envelope());

    expect(received).toHaveLength(2);
    expect(received[0]).toBe(received[1]);
    expect((received[0] as Record<string, unknown>).source_run_id).toBe(
      "github-actions:health-agent:123:1",
    );
    expect(maxActive).toBe(2);
    expect(result).toMatchObject({
      delivery_mode: "dual",
      primary_destination: "supabase",
    });
  });

  it("rejects a destination that returns a different source_run_id", async () => {
    const supabaseWriter = async () => ({
      duplicate: false,
      run_id: "supabase-run",
      source_run_id: "wrong-source-run",
    });
    const tursoWriter = async () => ({
      duplicate: false,
      run_id: "turso-run",
    });
    const delivery = createAgentHubDelivery({
      env: {},
      mode: "dual",
      supabaseWriter,
      tursoWriter,
    });

    await expect(delivery(envelope())).rejects.toMatchObject({
      failures: ["supabase"],
    });
  });

  it("reports partial delivery as failed and audits the failed destination", async () => {
    const records: unknown[] = [];
    const delivery = createAgentHubDelivery({
      env: {},
      logger: (record: unknown) => records.push(record),
      mode: "dual",
      supabaseWriter: async () => ({
        duplicate: false,
        run_id: "supabase-run",
      }),
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
          destination: "supabase",
          status: "success",
        }),
        expect.objectContaining({
          destination: "turso",
          status: "failure",
        }),
      ]),
    );
  });

  it("redacts destination failures before they reach the audit logger", async () => {
    const secret = "dual-window-secret";
    const records: unknown[] = [];
    const delivery = createAgentHubDelivery({
      env: {},
      logger: (record: unknown) => records.push(record),
      mode: "dual",
      secrets: [secret],
      supabaseWriter: async () => {
        throw new Error(`authorization=${secret}`);
      },
      tursoWriter: async () => ({
        duplicate: false,
        run_id: "turso-run",
      }),
    });

    await expect(delivery(envelope())).rejects.toBeInstanceOf(
      AgentHubDeliveryError,
    );
    expect(JSON.stringify(records)).not.toContain(secret);
    expect(JSON.stringify(records)).toContain("[REDACTED]");
  });

  it("does not contact Supabase in Turso-only mode", async () => {
    let supabaseCalls = 0;
    let tursoCalls = 0;
    const delivery = createAgentHubDelivery({
      env: {},
      mode: "turso",
      supabaseWriter: async () => {
        supabaseCalls += 1;
        return { duplicate: false, run_id: "supabase-run" };
      },
      tursoWriter: async () => {
        tursoCalls += 1;
        return { duplicate: false, run_id: "turso-run" };
      },
    });

    await expect(delivery(envelope())).resolves.toEqual({
      duplicate: false,
      run_id: "turso-run",
    });
    expect(tursoCalls).toBe(1);
    expect(supabaseCalls).toBe(0);
  });

  it("keeps the scoped Supabase ingest endpoint behind its provider adapter", async () => {
    const fetchImplementation = async (
      url: string,
      init?: RequestInit,
    ): Promise<Response> => {
      expect(url).toBe(
        "https://agent-hub.example/functions/v1/ingest-agent-run",
      );
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer supabase-window-secret",
      );
      expect(JSON.parse(String(init?.body))).toMatchObject({
        source_run_id: "github-actions:health-agent:123:1",
      });
      return new Response(
        JSON.stringify({ duplicate: false, run_id: "supabase-run" }),
        { status: 201 },
      );
    };
    const delivery = createAgentHubDelivery({
      env: {},
      mode: "dual",
      supabaseOptions: {
        fetchImplementation,
        token: "supabase-window-secret",
        url: "https://agent-hub.example/functions/v1/ingest-agent-run",
      },
      tursoWriter: async () => ({
        duplicate: false,
        run_id: "turso-run",
      }),
    });

    await expect(delivery(envelope())).resolves.toMatchObject({
      primary_destination: "supabase",
    });
  });

  it("fails closed when the production delivery mode is absent or invalid", () => {
    expect(() => createAgentHubDelivery({ env: {} })).toThrow(
      AgentHubDeliveryConfigurationError,
    );
    expect(() =>
      createAgentHubDelivery({
        env: { AGENT_HUB_DELIVERY_MODE: "fallback" },
      }),
    ).toThrow(AgentHubDeliveryConfigurationError);
  });
});
