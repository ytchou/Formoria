import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEventsHandler, type EventsRouteDeps } from "./route";

const TEST_SECRET = "test_signing_secret";
const TEST_OPERATORS = "U_OP1:op@formoria.com";

function makeDeps(overrides: Partial<EventsRouteDeps> = {}): EventsRouteDeps {
  return {
    verifySignature: vi.fn().mockReturnValue(true),
    postMessage: vi.fn().mockResolvedValue({ ok: true, ts: "msg.1" }),
    resolveChannelName: vi.fn().mockResolvedValue("formoria-ops"),
    evaluateGuards: vi.fn().mockReturnValue({ ok: true, operatorEmail: "op@formoria.com" }),
    createRequest: vi.fn().mockResolvedValue({
      duplicate: false,
      row: { id: "req-1", slackEventId: "evt-1", status: "received" },
    }),
    admitRequest: vi.fn().mockResolvedValue({
      ok: true,
      row: { id: "req-1", slackEventId: "evt-1", status: "received" },
    }),
    scheduleRun: vi.fn(),
    env: {
      SLACK_SIGNING_SECRET: TEST_SECRET,
      OPS_AGENT: "on",
      OPS_AGENT_OPERATORS: TEST_OPERATORS,
      OPS_AGENT_DAILY_CAP: "50",
    },
    ...overrides,
  };
}

function makeEventBody(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    type: "event_callback",
    event_id: "evt-1",
    event: {
      type: "app_mention",
      user: "U_OP1",
      channel: "C_OPS",
      ts: "1234.5678",
      text: "<@U0BOT> health status?",
      ...overrides,
    },
  });
}

function post(body: string, headers: Record<string, string> = {}) {
  return new Request("https://formoria.com/api/slack/events", {
    method: "POST",
    body,
    headers: {
      "x-slack-signature": "v0=valid",
      "x-slack-request-timestamp": String(Math.floor(Date.now() / 1000)),
      ...headers,
    },
  });
}

describe("/api/slack/events", () => {
  let deps: EventsRouteDeps;
  let handler: ReturnType<typeof createEventsHandler>;

  beforeEach(() => {
    deps = makeDeps();
    handler = createEventsHandler(deps);
  });

  it("rejects bad signature with 401", async () => {
    deps = makeDeps({ verifySignature: vi.fn().mockReturnValue(false) });
    handler = createEventsHandler(deps);

    const res = await handler(post(makeEventBody()));
    expect(res.status).toBe(401);
    expect(deps.createRequest).not.toHaveBeenCalled();
  });

  it("answers url_verification challenge", async () => {
    const body = JSON.stringify({ type: "url_verification", challenge: "abc123" });
    const res = await handler(post(body));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.challenge).toBe("abc123");
  });

  it("bot_message_without_json_block_is_silently_ignored", async () => {
    const body = makeEventBody({ bot_id: "B_BOT", text: "<@U0BOT> hello world" });
    const res = await handler(post(body));
    expect(res.status).toBe(200);
    expect(deps.evaluateGuards).not.toHaveBeenCalled();
    expect(deps.scheduleRun).not.toHaveBeenCalled();
  });

  it("bot_message_with_json_block_reaches_scheduleRun", async () => {
    const jsonText =
      "<@U0BOT> ```json\n" +
      '{"agent":"health","ref":"abc","runId":"run-1","scope":[],' +
      '"findings":[{"fingerprint":"f1","title":"unused export","severity":"warn","source":"knip"}]}' +
      "\n```";
    const body = makeEventBody({ bot_id: "B_BOT", text: jsonText });
    const res = await handler(post(body));
    expect(res.status).toBe(200);
    expect(deps.evaluateGuards).not.toHaveBeenCalled();
    expect(deps.admitRequest).toHaveBeenCalledWith(
      expect.objectContaining({ operatorEmail: "system:bot" }),
      Number.MAX_SAFE_INTEGER,
    );
    expect(deps.scheduleRun).toHaveBeenCalled();
  });

  it("system_bot_wrong_channel_is_ignored", async () => {
    deps = makeDeps({
      resolveChannelName: vi.fn().mockResolvedValue("random-channel"),
    });
    handler = createEventsHandler(deps);
    const jsonText = "<@U0BOT> ```json\n" + '{"agent":"health"}' + "\n```";
    const body = makeEventBody({ bot_id: "B_BOT", text: jsonText });
    const res = await handler(post(body));
    expect(res.status).toBe(200);
    expect(deps.scheduleRun).not.toHaveBeenCalled();
  });

  it("system_bot_ops_agent_off_is_ignored", async () => {
    deps = makeDeps({
      env: {
        SLACK_SIGNING_SECRET: TEST_SECRET,
        OPS_AGENT: "off",
        OPS_AGENT_OPERATORS: TEST_OPERATORS,
        OPS_AGENT_DAILY_CAP: "50",
      },
    });
    handler = createEventsHandler(deps);
    const jsonText = "<@U0BOT> ```json\n" + '{"agent":"health"}' + "\n```";
    const body = makeEventBody({ bot_id: "B_BOT", text: jsonText });
    const res = await handler(post(body));
    expect(res.status).toBe(200);
    expect(deps.scheduleRun).not.toHaveBeenCalled();
  });

  it("bot_message_with_unknown_user_still_admitted", async () => {
    const jsonText =
      "<@U0BOT> ```json\n" +
      '{"agent":"health","ref":"abc","runId":"run-1","scope":[],' +
      '"findings":[{"fingerprint":"f1","title":"unused export","severity":"warn","source":"knip"}]}' +
      "\n```";
    const body = makeEventBody({ bot_id: "B_BOT", user: "U_UNKNOWN", text: jsonText });
    const res = await handler(post(body));
    expect(res.status).toBe(200);
    expect(deps.evaluateGuards).not.toHaveBeenCalled();
    expect(deps.admitRequest).toHaveBeenCalledWith(
      expect.objectContaining({ operatorEmail: "system:bot", slackUserId: "U_UNKNOWN" }),
      Number.MAX_SAFE_INTEGER,
    );
    expect(deps.scheduleRun).toHaveBeenCalled();
  });

  it("non_app_mention_events_still_ignored", async () => {
    const nonMention = JSON.stringify({
      type: "event_callback",
      event_id: "evt-2",
      event: { type: "message", user: "U_OP1", channel: "C_OPS", ts: "1234.5679" },
    });
    const res = await handler(post(nonMention));
    expect(res.status).toBe(200);
    expect(deps.evaluateGuards).not.toHaveBeenCalled();
  });

  it("human_message_uses_existing_guard_flow", async () => {
    const body = makeEventBody();
    const res = await handler(post(body));
    expect(res.status).toBe(200);
    expect(deps.evaluateGuards).toHaveBeenCalled();
  });

  it("duplicate event is acked without second run", async () => {
    deps = makeDeps({
      admitRequest: vi.fn().mockResolvedValue({ ok: true, row: undefined }),
    });
    handler = createEventsHandler(deps);

    const res = await handler(post(makeEventBody()));
    expect(res.status).toBe(200);
    expect(deps.scheduleRun).not.toHaveBeenCalled();
  });

  it("kill switch replies off", async () => {
    deps = makeDeps({
      evaluateGuards: vi.fn().mockReturnValue({ ok: false, reason: "off" }),
    });
    handler = createEventsHandler(deps);

    const res = await handler(post(makeEventBody()));
    expect(res.status).toBe(200);
    expect(deps.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: "The ops agent is currently off." }),
    );
    expect(deps.createRequest).not.toHaveBeenCalled();
  });

  it("guard refusal writes refused row and replies", async () => {
    deps = makeDeps({
      evaluateGuards: vi.fn().mockReturnValue({ ok: false, reason: "not_operator" }),
    });
    handler = createEventsHandler(deps);

    const res = await handler(post(makeEventBody()));
    expect(res.status).toBe(200);
    expect(deps.createRequest).toHaveBeenCalledWith(
      expect.objectContaining({ status: "refused", operatorEmail: null }),
    );
    expect(deps.postMessage).toHaveBeenCalledTimes(1);
    expect(deps.scheduleRun).not.toHaveBeenCalled();
  });

  it("daily cap refusal happens before scheduling", async () => {
    deps = makeDeps({
      admitRequest: vi.fn().mockResolvedValue({ ok: false, reason: "daily_cap" }),
    });
    handler = createEventsHandler(deps);

    const res = await handler(post(makeEventBody()));
    expect(res.status).toBe(200);
    expect(deps.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining("cap") }),
    );
    expect(deps.scheduleRun).not.toHaveBeenCalled();
  });

  it("mention text is stripped of bot handle", async () => {
    const res = await handler(post(makeEventBody()));
    expect(res.status).toBe(200);
    expect(deps.admitRequest).toHaveBeenCalledWith(
      expect.objectContaining({ text: "health status?" }),
      50,
    );
  });
});
