import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createInteractionsHandler,
  type InteractionsRouteDeps,
} from "./route";

const TEST_SECRET = "test_signing_secret";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "req-1",
    slackEventId: "evt-1",
    slackUserId: "U_OP1",
    operatorEmail: "op@formoria.com",
    channelId: "C_OPS",
    threadTs: "1234.5678",
    cardTs: "msg.1",
    text: "rerun enrichment for slug-x",
    status: "awaiting_confirm",
    result: null,
    proposal: { kind: "refresh_brand", slug: "slug-x" },
    toolCalls: [],
    modelCalls: 1,
    costUsd: 0,
    correlationId: null,
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
    createdAt: "2026-09-15T00:00:00Z",
    updatedAt: "2026-09-15T00:00:00Z",
    ...overrides,
  };
}

function makeDeps(
  overrides: Partial<InteractionsRouteDeps> = {},
): InteractionsRouteDeps {
  return {
    verifySignature: vi.fn().mockReturnValue(true),
    updateMessage: vi.fn().mockResolvedValue({ ok: true }),
    renderResultCard: vi.fn().mockReturnValue([]),
    getRequest: vi.fn().mockResolvedValue(makeRow()),
    transitionRequest: vi.fn().mockResolvedValue(makeRow()),
    executeProposal: vi.fn().mockResolvedValue({ ok: true, result: { jobId: "j-1" } }),
    describeProposal: vi.fn().mockReturnValue({ action: "Refresh brand", steps: "…", why: "…", cost: "…" }),
    scheduleAfter: vi.fn(async (fn: () => Promise<void>) => { await fn(); }),
    env: { SLACK_SIGNING_SECRET: TEST_SECRET },
    ...overrides,
  };
}

function makePayload(actionId = "ops_confirm", userId = "U_OP1") {
  return `payload=${encodeURIComponent(JSON.stringify({
    type: "block_actions",
    user: { id: userId },
    channel: { id: "C_OPS" },
    message: { ts: "msg.1" },
    actions: [{ action_id: actionId, value: "req-1" }],
  }))}`;
}

function post(body: string) {
  return new Request("https://formoria.com/api/slack/interactions", {
    method: "POST",
    body,
    headers: {
      "x-slack-signature": "v0=valid",
      "x-slack-request-timestamp": String(Math.floor(Date.now() / 1000)),
      "content-type": "application/x-www-form-urlencoded",
    },
  });
}

describe("/api/slack/interactions", () => {
  let deps: InteractionsRouteDeps;
  let handler: ReturnType<typeof createInteractionsHandler>;

  beforeEach(() => {
    deps = makeDeps();
    handler = createInteractionsHandler(deps);
  });

  it("rejects bad signature with 401", async () => {
    deps = makeDeps({ verifySignature: vi.fn().mockReturnValue(false) });
    handler = createInteractionsHandler(deps);

    const res = await handler(post(makePayload()));
    expect(res.status).toBe(401);
  });

  it("non-requester click is ignored", async () => {
    const res = await handler(post(makePayload("ops_confirm", "U_OTHER")));
    expect(res.status).toBe(200);
    expect(deps.transitionRequest).not.toHaveBeenCalled();
  });

  it("expired row is marked expired", async () => {
    deps = makeDeps({
      getRequest: vi.fn().mockResolvedValue(
        makeRow({ expiresAt: new Date(Date.now() - 60_000).toISOString() }),
      ),
    });
    handler = createInteractionsHandler(deps);

    const res = await handler(post(makePayload()));
    expect(res.status).toBe(200);
    expect(deps.transitionRequest).toHaveBeenCalledWith(
      "req-1",
      ["awaiting_confirm"],
      "expired",
      expect.objectContaining({ result: { reason: "expired" } }),
    );
    expect(deps.executeProposal).not.toHaveBeenCalled();
  });

  it("cancel marks cancelled", async () => {
    const res = await handler(post(makePayload("ops_cancel")));
    expect(res.status).toBe(200);
    expect(deps.transitionRequest).toHaveBeenCalledWith(
      "req-1",
      ["awaiting_confirm"],
      "cancelled",
      expect.objectContaining({ result: { reason: "cancelled_by_operator" } }),
    );
    expect(deps.executeProposal).not.toHaveBeenCalled();
  });

  it("confirm transitions then schedules execution", async () => {
    const res = await handler(post(makePayload("ops_confirm")));
    await new Promise((r) => setTimeout(r, 0));
    expect(res.status).toBe(200);
    expect(deps.transitionRequest).toHaveBeenCalledWith(
      "req-1",
      ["awaiting_confirm"],
      "running",
      expect.anything(),
    );
    expect(deps.scheduleAfter).toHaveBeenCalled();
    expect(deps.executeProposal).toHaveBeenCalled();
  });

  it("ack does not await Slack", async () => {
    deps = makeDeps({
      scheduleAfter: vi.fn(),
    });
    handler = createInteractionsHandler(deps);

    const res = await handler(post(makePayload("ops_confirm")));
    expect(res.status).toBe(200);
    expect(deps.executeProposal).not.toHaveBeenCalled();
  });
});
