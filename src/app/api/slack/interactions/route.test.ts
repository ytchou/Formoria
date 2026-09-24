import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderResultCard } from "@/lib/adapters/slack/blocks";
import { STALE_CHECK_MS } from "@/lib/services/ops-agent/dispatches";
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
    sleep: vi.fn().mockResolvedValue(undefined),
    markDispatchStale: vi.fn().mockResolvedValue(false),
    postMessage: vi.fn().mockResolvedValue({ ok: true, ts: "p.1" }),
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

  it("executed dispatch renders summary text, not JSON", async () => {
    const summary = "Started e2e run on staging (~20 min). Updates will post in this thread.";
    deps = makeDeps({
      getRequest: vi.fn().mockResolvedValue(
        makeRow({ proposal: { kind: "dispatch_workflow", workflow: "e2e-staging", mode: "run" } }),
      ),
      executeProposal: vi.fn().mockResolvedValue({
        ok: true,
        result: { dispatched: "e2e-staging", summary },
      }),
      renderResultCard: vi.fn(renderResultCard),
    });
    handler = createInteractionsHandler(deps);

    await handler(post(makePayload("ops_confirm")));
    await new Promise((r) => setTimeout(r, 0));

    expect(deps.renderResultCard).toHaveBeenCalledWith(
      expect.objectContaining({ summary }),
    );
    const update = vi
      .mocked(deps.updateMessage)
      .mock.calls.find(([arg]) => arg.blocks !== undefined);
    expect(update).toBeDefined();
    const blocksText = JSON.stringify(update?.[0].blocks);
    expect(blocksText).toContain("Started e2e run on staging");
    expect(blocksText).not.toContain('{\\"dispatched');
    expect(blocksText).not.toContain('{"dispatched');
  });

  it("non-dispatch results render without a summary", async () => {
    await handler(post(makePayload("ops_confirm")));
    await new Promise((r) => setTimeout(r, 0));

    expect(deps.renderResultCard).toHaveBeenCalledWith({
      proposal: "Refresh brand",
      result: JSON.stringify({ jobId: "j-1" }),
    });
    expect(deps.sleep).not.toHaveBeenCalled();
    expect(deps.markDispatchStale).not.toHaveBeenCalled();
  });

  it("dispatch_workflow stale check posts 'didn't start' when the dispatch was never claimed", async () => {
    deps = makeDeps({
      getRequest: vi.fn().mockResolvedValue(
        makeRow({ proposal: { kind: "dispatch_workflow", workflow: "e2e-staging", mode: "run" } }),
      ),
      executeProposal: vi.fn().mockResolvedValue({
        ok: true,
        result: { dispatched: "e2e-staging", summary: "Started" },
      }),
      markDispatchStale: vi.fn().mockResolvedValue(true),
    });
    handler = createInteractionsHandler(deps);

    await handler(post(makePayload("ops_confirm")));
    await new Promise((r) => setTimeout(r, 0));

    expect(deps.sleep).toHaveBeenCalledWith(STALE_CHECK_MS);
    expect(deps.markDispatchStale).toHaveBeenCalledWith("req-1");
    expect(deps.postMessage).toHaveBeenCalledWith({
      channel: "C_OPS",
      threadTs: "1234.5678",
      text: "The e2e run didn't start within 5 minutes. A scheduled run was probably active. Ask again in a few minutes.",
    });
  });

  it("dispatch_workflow stale check posts nothing when the dispatch was claimed", async () => {
    deps = makeDeps({
      getRequest: vi.fn().mockResolvedValue(
        makeRow({ proposal: { kind: "dispatch_workflow", workflow: "e2e-staging", mode: "run" } }),
      ),
      executeProposal: vi.fn().mockResolvedValue({
        ok: true,
        result: { dispatched: "e2e-staging", summary: "Started" },
      }),
      markDispatchStale: vi.fn().mockResolvedValue(false),
    });
    handler = createInteractionsHandler(deps);

    await handler(post(makePayload("ops_confirm")));
    await new Promise((r) => setTimeout(r, 0));

    expect(deps.markDispatchStale).toHaveBeenCalledWith("req-1");
    expect(deps.postMessage).not.toHaveBeenCalled();
  });

  it("stale check failure is contained and posts nothing", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    deps = makeDeps({
      getRequest: vi.fn().mockResolvedValue(
        makeRow({ proposal: { kind: "dispatch_workflow", workflow: "e2e-staging", mode: "run" } }),
      ),
      executeProposal: vi.fn().mockResolvedValue({
        ok: true,
        result: { dispatched: "e2e-staging", summary: "Started" },
      }),
      markDispatchStale: vi.fn().mockRejectedValue(new Error("db down")),
    });
    handler = createInteractionsHandler(deps);

    const response = await handler(post(makePayload("ops_confirm")));
    await new Promise((r) => setTimeout(r, 0));

    expect(response.status).toBe(200);
    expect(deps.markDispatchStale).toHaveBeenCalledWith("req-1");
    expect(deps.postMessage).not.toHaveBeenCalled();
    // The rejection stays inside the stale check: the request is not failed.
    expect(deps.transitionRequest).not.toHaveBeenCalledWith(
      "req-1",
      ["running"],
      "failed",
      expect.anything(),
    );
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("stale check is scheduled even when the executed transition throws", async () => {
    deps = makeDeps({
      getRequest: vi.fn().mockResolvedValue(
        makeRow({ proposal: { kind: "dispatch_workflow", workflow: "e2e-staging", mode: "run" } }),
      ),
      transitionRequest: vi.fn(
        async (_id: string, _from: string[], to: string) => {
          if (to === "executed") throw new Error("transition failed");
          return makeRow();
        },
      ) as unknown as InteractionsRouteDeps["transitionRequest"],
      executeProposal: vi.fn().mockResolvedValue({
        ok: true,
        result: { dispatched: "e2e-staging", summary: "Started" },
      }),
      markDispatchStale: vi.fn().mockResolvedValue(true),
    });
    handler = createInteractionsHandler(deps);

    await handler(post(makePayload("ops_confirm")));
    await new Promise((r) => setTimeout(r, 0));

    expect(deps.markDispatchStale).toHaveBeenCalledWith("req-1");
    expect(deps.postMessage).toHaveBeenCalledTimes(1);
  });

  it("failed dispatch schedules no stale check", async () => {
    deps = makeDeps({
      getRequest: vi.fn().mockResolvedValue(
        makeRow({ proposal: { kind: "dispatch_workflow", workflow: "e2e-staging", mode: "run" } }),
      ),
      executeProposal: vi.fn().mockResolvedValue({
        ok: false,
        error: "An e2e run is already in progress — https://slack.com/archives/C_OPS/p1",
      }),
    });
    handler = createInteractionsHandler(deps);

    await handler(post(makePayload("ops_confirm")));
    await new Promise((r) => setTimeout(r, 0));

    expect(deps.renderResultCard).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining("already in progress") }),
    );
    expect(deps.sleep).not.toHaveBeenCalled();
    expect(deps.markDispatchStale).not.toHaveBeenCalled();
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
