import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetAuditEmitterForTests,
  setAuditWriteSeam,
  type AuditRecord,
} from "@/lib/audit";
import { postMessage, updateMessage } from "../web-api";

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
