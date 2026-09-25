import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetAuditEmitterForTests,
  setAuditWriteSeam,
  type AuditRecord,
} from "@/lib/audit";
import { postMessage, readMessageMetadata, updateMessage } from "../web-api";

let writes: AuditRecord[] = [];

beforeEach(() => {
  writes = [];
  setAuditWriteSeam(async (record) => {
    writes.push(record);
    return null;
  });
  vi.stubEnv("SLACK_BOT_TOKEN", "xoxb-test-token");
});

afterEach(() => {
  resetAuditEmitterForTests();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("postMessage", () => {
  it("post_message_sends_thread_ts_and_returns_ts", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ ok: true, ts: "1234567890.123456" }));

    const result = await postMessage({
      channel: "C12345",
      threadTs: "1234567890.000001",
      text: "Hello from ops agent",
      blocks: [{ type: "section", text: { type: "mrkdwn", text: "hello" } }],
    });

    expect(result).toEqual({ ok: true, ts: "1234567890.123456" });
    expect(fetchMock).toHaveBeenCalledOnce();

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://slack.com/api/chat.postMessage");
    const body = JSON.parse(init!.body as string);
    expect(body).toMatchObject({
      channel: "C12345",
      thread_ts: "1234567890.000001",
      text: "Hello from ops agent",
      blocks: [{ type: "section", text: { type: "mrkdwn", text: "hello" } }],
    });
    expect((init!.headers as Record<string, string>).Authorization).toBe(
      "Bearer xoxb-test-token",
    );
  });

  it("slack_api_error_is_returned_not_thrown", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ ok: false, error: "channel_not_found" }),
    );

    const result = await postMessage({
      channel: "C_BAD",
      text: "nope",
    });

    expect(result).toEqual({ ok: false, error: "channel_not_found" });
  });
});

describe("updateMessage", () => {
  it("update_message_uses_chat_update", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ ok: true }));

    const result = await updateMessage({
      channel: "C12345",
      ts: "1234567890.123456",
      text: "Updated message",
    });

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledOnce();

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://slack.com/api/chat.update");
    const body = JSON.parse(init!.body as string);
    expect(body).toMatchObject({
      channel: "C12345",
      ts: "1234567890.123456",
      text: "Updated message",
    });
  });
});

const METADATA = {
  event_type: "formoria_run_timeline",
  event_payload: { agent: "health", runId: "run-1" },
};

describe("message metadata", () => {
  it("post_message_sends_metadata_when_set", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ ok: true, ts: "1.1" }));

    await postMessage({ channel: "C1", text: "hi", metadata: METADATA });

    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(body.metadata).toEqual(METADATA);
  });

  it("post_message_omits_metadata_when_unset", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ ok: true, ts: "1.1" }));

    await postMessage({ channel: "C1", text: "hi" });

    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(body).not.toHaveProperty("metadata");
  });

  it("update_message_sends_metadata_when_set", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ ok: true }));

    await updateMessage({ channel: "C1", ts: "1.1", text: "hi", metadata: METADATA });

    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(body.metadata).toEqual(METADATA);
  });
});

describe("readMessageMetadata", () => {
  it("read_returns_metadata_of_matching_message", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ ok: true, messages: [{ ts: "1.1", metadata: METADATA }] }),
    );

    const result = await readMessageMetadata({ channel: "C1", ts: "1.1" });

    expect(result).toEqual({ ok: true, metadata: METADATA });
    expect(fetchMock).toHaveBeenCalledOnce();
    const url = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(url.origin + url.pathname).toBe(
      "https://slack.com/api/conversations.history",
    );
    expect(url.searchParams.get("channel")).toBe("C1");
    expect(url.searchParams.get("latest")).toBe("1.1");
    expect(url.searchParams.get("oldest")).toBe("1.1");
    expect(url.searchParams.get("inclusive")).toBe("true");
    expect(url.searchParams.get("limit")).toBe("1");
    expect(url.searchParams.get("include_all_metadata")).toBe("true");
    expect(writes.some((w) => w.operation === "read_message_metadata")).toBe(true);
  });

  it("read_falls_back_to_replies_for_thread_reply", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ ok: true, messages: [] }))
      .mockResolvedValueOnce(
        Response.json({ ok: true, messages: [{ ts: "2.2", metadata: METADATA }] }),
      );

    const result = await readMessageMetadata({ channel: "C1", ts: "2.2" });

    expect(result).toEqual({ ok: true, metadata: METADATA });
    const url = new URL(fetchMock.mock.calls[1]![0] as string);
    expect(url.pathname).toBe("/api/conversations.replies");
    expect(url.searchParams.get("ts")).toBe("2.2");
  });

  it("read_returns_null_when_no_message_matches", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ ok: true, messages: [{ ts: "9.9" }] }))
      .mockResolvedValueOnce(Response.json({ ok: false, error: "thread_not_found" }));

    const result = await readMessageMetadata({ channel: "C1", ts: "1.1" });

    expect(result).toEqual({ ok: true, metadata: null });
  });

  it("read_returns_error_when_slack_fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ ok: false, error: "missing_scope" }),
    );

    const result = await readMessageMetadata({ channel: "C1", ts: "1.1" });

    expect(result).toEqual({ ok: false, error: "missing_scope" });
  });
});
