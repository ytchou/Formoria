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

const CHANNEL = "C0BJ6TWPDF1";
const PARENT_TS = "1790309700.000100";
const REPLY_TS = "1790309764.000200";

const METADATA = {
  event_type: "formoria_run_timeline",
  event_payload: {
    agent: "e2e-agent",
    title: "E2E nightly",
    runId: "7f3c2a1e-4b8d-4c1f-9e2a-5d6b7c8e9f01",
    events: [{ kind: "started", at: 1790309764 }],
  },
};

describe("message metadata", () => {
  it("sends run-timeline metadata with a posted message", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ ok: true, ts: PARENT_TS }));

    await postMessage({ channel: CHANNEL, text: "E2E nightly · Running", metadata: METADATA });

    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(body.metadata).toEqual(METADATA);
  });

  it("posts a plain message without a metadata key", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ ok: true, ts: PARENT_TS }));

    await postMessage({ channel: CHANNEL, text: "E2E nightly · Running" });

    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(body).not.toHaveProperty("metadata");
  });

  it("sends run-timeline metadata with a message update", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ ok: true }));

    await updateMessage({
      channel: CHANNEL,
      ts: PARENT_TS,
      text: "E2E nightly · Completed",
      metadata: METADATA,
    });

    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(body.metadata).toEqual(METADATA);
  });
});

describe("readMessageMetadata", () => {
  it("returns the metadata of a top-level timeline message", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ ok: true, messages: [{ ts: PARENT_TS, metadata: METADATA }] }),
    );

    const result = await readMessageMetadata({ channel: CHANNEL, ts: PARENT_TS });

    expect(result).toEqual({ ok: true, metadata: METADATA });
    expect(fetchMock).toHaveBeenCalledOnce();
    const url = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(url.origin + url.pathname).toBe(
      "https://slack.com/api/conversations.history",
    );
    expect(url.searchParams.get("channel")).toBe(CHANNEL);
    expect(url.searchParams.get("latest")).toBe(PARENT_TS);
    expect(url.searchParams.get("oldest")).toBe(PARENT_TS);
    expect(url.searchParams.get("inclusive")).toBe("true");
    expect(url.searchParams.get("limit")).toBe("1");
    expect(url.searchParams.get("include_all_metadata")).toBe("true");
    expect(writes.some((w) => w.operation === "read_message_metadata")).toBe(true);
  });

  it("finds a timeline posted as a thread reply even though Slack returns the parent first", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ ok: true, messages: [] }))
      .mockResolvedValueOnce(
        Response.json({
          ok: true,
          messages: [
            { ts: PARENT_TS, text: "Run E2E nightly please" },
            { ts: REPLY_TS, thread_ts: PARENT_TS, metadata: METADATA },
          ],
        }),
      );

    const result = await readMessageMetadata({ channel: CHANNEL, ts: REPLY_TS });

    expect(result).toEqual({ ok: true, metadata: METADATA });
    const url = new URL(fetchMock.mock.calls[1]![0] as string);
    expect(url.pathname).toBe("/api/conversations.replies");
    expect(url.searchParams.get("channel")).toBe(CHANNEL);
    expect(url.searchParams.get("ts")).toBe(REPLY_TS);
    expect(url.searchParams.get("oldest")).toBe(REPLY_TS);
    expect(url.searchParams.get("inclusive")).toBe("true");
    expect(url.searchParams.get("include_all_metadata")).toBe("true");
    expect(url.searchParams.get("limit")).not.toBe("1");
    expect(url.searchParams.has("latest")).toBe(false);
  });

  it("reports no metadata when the message exists nowhere", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        Response.json({ ok: true, messages: [{ ts: "1790309999.000300" }] }),
      )
      .mockResolvedValueOnce(Response.json({ ok: false, error: "thread_not_found" }));

    const result = await readMessageMetadata({ channel: CHANNEL, ts: PARENT_TS });

    expect(result).toEqual({ ok: true, metadata: null });
  });

  it("surfaces the Slack error when the history read fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ ok: false, error: "missing_scope" }),
    );

    const result = await readMessageMetadata({ channel: CHANNEL, ts: PARENT_TS });

    expect(result).toEqual({ ok: false, error: "missing_scope" });
  });
});
