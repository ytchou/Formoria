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
    isActiveThread: vi.fn().mockResolvedValue(false),
    completeThread: vi.fn().mockResolvedValue(1),
    reactivateThread: vi.fn().mockResolvedValue(1),
    addReaction: vi.fn().mockResolvedValue({ ok: true }),
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

  it("bot_message_event_with_json_block_reaches_scheduleRun", async () => {
    const jsonText =
      "<@U0BOT> ```json\n" +
      '{"agent":"health","ref":"abc","runId":"run-1","scope":[],' +
      '"findings":[{"fingerprint":"f1","title":"unused export","severity":"warn","source":"knip"}]}' +
      "\n```";
    const body = JSON.stringify({
      type: "event_callback",
      event_id: "evt-msg-1",
      event: {
        type: "message",
        bot_id: "B_BOT",
        channel: "C_OPS",
        ts: "1234.5680",
        text: jsonText,
      },
    });
    const res = await handler(post(body));
    expect(res.status).toBe(200);
    expect(deps.admitRequest).toHaveBeenCalledWith(
      expect.objectContaining({ operatorEmail: "system:bot" }),
      Number.MAX_SAFE_INTEGER,
    );
    expect(deps.scheduleRun).toHaveBeenCalled();
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

  it("threaded_bot_message_with_json_block_reaches_scheduleRun", async () => {
    const jsonText =
      "<@U0BOT> ```json\n" +
      '{"agent":"health","ref":"abc","runId":"run-1","scope":[],' +
      '"findings":[{"fingerprint":"f1","title":"unused export","severity":"warn","source":"knip"}]}' +
      "\n```";
    const body = JSON.stringify({
      type: "event_callback",
      event_id: "evt-msg-2",
      event: {
        type: "message",
        bot_id: "B_BOT",
        channel: "C_OPS",
        ts: "1234.5690",
        thread_ts: "1234.5680",
        text: jsonText,
      },
    });
    const res = await handler(post(body));
    expect(res.status).toBe(200);
    expect(deps.admitRequest).toHaveBeenCalledWith(
      expect.objectContaining({ operatorEmail: "system:bot" }),
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

  it("thread_reply_in_active_thread_is_processed", async () => {
    deps = makeDeps({
      isActiveThread: vi.fn().mockResolvedValue(true),
    });
    handler = createEventsHandler(deps);

    const body = JSON.stringify({
      type: "event_callback",
      event_id: "evt-thread-1",
      event: {
        type: "message",
        user: "U_OP1",
        channel: "C_OPS",
        ts: "1234.9999",
        thread_ts: "1234.5678",
        text: "what about the other brand?",
      },
    });

    const res = await handler(post(body));
    expect(res.status).toBe(200);
    expect(deps.isActiveThread).toHaveBeenCalledWith("C_OPS", "1234.5678");
    expect(deps.evaluateGuards).toHaveBeenCalled();
    expect(deps.admitRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "what about the other brand?",
        threadTs: "1234.5678",
      }),
      50,
    );
    expect(deps.scheduleRun).toHaveBeenCalled();
  });

  it("thread_reply_in_inactive_thread_is_ignored", async () => {
    const body = JSON.stringify({
      type: "event_callback",
      event_id: "evt-thread-2",
      event: {
        type: "message",
        user: "U_OP1",
        channel: "C_OPS",
        ts: "1234.9999",
        thread_ts: "1234.5678",
        text: "hello?",
      },
    });

    const res = await handler(post(body));
    expect(res.status).toBe(200);
    expect(deps.isActiveThread).toHaveBeenCalledWith("C_OPS", "1234.5678");
    expect(deps.evaluateGuards).not.toHaveBeenCalled();
    expect(deps.scheduleRun).not.toHaveBeenCalled();
  });

  it("thread_reply_from_bot_is_ignored", async () => {
    const body = JSON.stringify({
      type: "event_callback",
      event_id: "evt-thread-3",
      event: {
        type: "message",
        bot_id: "B_AGENT",
        channel: "C_OPS",
        ts: "1234.9999",
        thread_ts: "1234.5678",
        text: "I am a bot replying",
      },
    });

    const res = await handler(post(body));
    expect(res.status).toBe(200);
    expect(deps.isActiveThread).not.toHaveBeenCalled();
    expect(deps.scheduleRun).not.toHaveBeenCalled();
  });

  it("thread_reply_with_subtype_is_ignored", async () => {
    const body = JSON.stringify({
      type: "event_callback",
      event_id: "evt-thread-4",
      event: {
        type: "message",
        subtype: "message_changed",
        user: "U_OP1",
        channel: "C_OPS",
        ts: "1234.9999",
        thread_ts: "1234.5678",
        text: "edited message",
      },
    });

    const res = await handler(post(body));
    expect(res.status).toBe(200);
    expect(deps.isActiveThread).not.toHaveBeenCalled();
    expect(deps.scheduleRun).not.toHaveBeenCalled();
  });

  it("thread_reply_with_mention_is_skipped_for_app_mention_path", async () => {
    deps = makeDeps({
      isActiveThread: vi.fn().mockResolvedValue(true),
    });
    handler = createEventsHandler(deps);

    const body = JSON.stringify({
      type: "event_callback",
      event_id: "evt-thread-5",
      event: {
        type: "message",
        user: "U_OP1",
        channel: "C_OPS",
        ts: "1234.9999",
        thread_ts: "1234.5678",
        text: "<@U0BOT> check this again",
      },
    });

    const res = await handler(post(body));
    expect(res.status).toBe(200);
    expect(deps.isActiveThread).not.toHaveBeenCalled();
    expect(deps.scheduleRun).not.toHaveBeenCalled();
  });

  it("eyes_reaction_fired_on_admission", async () => {
    const res = await handler(post(makeEventBody()));
    expect(res.status).toBe(200);
    expect(deps.addReaction).toHaveBeenCalledWith({
      channel: "C_OPS",
      timestamp: "1234.5678",
      name: "eyes",
    });
    expect(deps.scheduleRun).toHaveBeenCalled();
  });

  it("failed_reaction_does_not_block_processing", async () => {
    deps = makeDeps({
      addReaction: vi.fn().mockRejectedValue(new Error("rate_limited")),
    });
    handler = createEventsHandler(deps);

    const res = await handler(post(makeEventBody()));
    expect(res.status).toBe(200);
    expect(deps.scheduleRun).toHaveBeenCalled();
  });

  it("no_reaction_when_daily_cap_reached", async () => {
    deps = makeDeps({
      admitRequest: vi.fn().mockResolvedValue({ ok: false, reason: "daily_cap" }),
    });
    handler = createEventsHandler(deps);

    const res = await handler(post(makeEventBody()));
    expect(res.status).toBe(200);
    expect(deps.addReaction).not.toHaveBeenCalled();
  });

  it("routine_reply_in_active_thread_is_ignored", async () => {
    deps = makeDeps({
      isActiveThread: vi.fn().mockResolvedValue(true),
    });
    handler = createEventsHandler(deps);

    const body = JSON.stringify({
      type: "event_callback",
      event_id: "evt-routine-1",
      event: {
        type: "message",
        user: "U_OP1",
        channel: "C_OPS",
        ts: "1234.9999",
        thread_ts: "1234.5678",
        text: "Here are the investigation results...\n\nSent using Claude",
      },
    });

    const res = await handler(post(body));
    expect(res.status).toBe(200);
    expect(deps.isActiveThread).not.toHaveBeenCalled();
    expect(deps.scheduleRun).not.toHaveBeenCalled();
  });

  it("reaction_added_white_check_mark_calls_completeThread", async () => {
    const body = JSON.stringify({
      type: "event_callback",
      event_id: "evt-react-1",
      event: {
        type: "reaction_added",
        user: "U_OP1",
        reaction: "white_check_mark",
        item: { type: "message", channel: "C_OPS", ts: "1234.5678" },
      },
    });

    const res = await handler(post(body));
    expect(res.status).toBe(200);
    expect(deps.completeThread).toHaveBeenCalledWith("C_OPS", "1234.5678");
    expect(deps.reactivateThread).not.toHaveBeenCalled();
    expect(deps.scheduleRun).not.toHaveBeenCalled();
  });

  it("reaction_removed_white_check_mark_calls_reactivateThread", async () => {
    const body = JSON.stringify({
      type: "event_callback",
      event_id: "evt-react-2",
      event: {
        type: "reaction_removed",
        user: "U_OP1",
        reaction: "white_check_mark",
        item: { type: "message", channel: "C_OPS", ts: "1234.5678" },
      },
    });

    const res = await handler(post(body));
    expect(res.status).toBe(200);
    expect(deps.reactivateThread).toHaveBeenCalledWith("C_OPS", "1234.5678");
    expect(deps.completeThread).not.toHaveBeenCalled();
  });

  it("reaction_added_non_check_mark_is_ignored", async () => {
    const body = JSON.stringify({
      type: "event_callback",
      event_id: "evt-react-3",
      event: {
        type: "reaction_added",
        user: "U_OP1",
        reaction: "thumbsup",
        item: { type: "message", channel: "C_OPS", ts: "1234.5678" },
      },
    });

    const res = await handler(post(body));
    expect(res.status).toBe(200);
    expect(deps.completeThread).not.toHaveBeenCalled();
    expect(deps.reactivateThread).not.toHaveBeenCalled();
  });

  it("reaction_on_non_message_is_ignored", async () => {
    const body = JSON.stringify({
      type: "event_callback",
      event_id: "evt-react-4",
      event: {
        type: "reaction_added",
        user: "U_OP1",
        reaction: "white_check_mark",
        item: { type: "file", file: "F123" },
      },
    });

    const res = await handler(post(body));
    expect(res.status).toBe(200);
    expect(deps.completeThread).not.toHaveBeenCalled();
  });
});
