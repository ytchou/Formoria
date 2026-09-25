import { afterEach, describe, expect, it, vi } from "vitest";
import { appendRunEvent, startTimeline, type TimelineDeps } from "../append";
import { RUN_TIMELINE_EVENT_TYPE, type RunTimeline } from "../types";

const REF = { channel: "C1", ts: "100.1" };

const EXISTING: RunTimeline = {
  agent: "health",
  title: "Health agent",
  runId: "run-1",
  events: [{ kind: "started", at: 1000 }],
};

type PostFn = TimelineDeps["postMessage"];
type UpdateFn = TimelineDeps["updateMessage"];
type ReadFn = TimelineDeps["readMessageMetadata"];

function makeDeps(
  overrides: {
    postMessage?: PostFn;
    updateMessage?: UpdateFn;
    readMessageMetadata?: ReadFn;
  } = {},
) {
  return {
    postMessage: vi.fn<PostFn>(
      overrides.postMessage ?? (async () => ({ ok: true as const, ts: "100.1" })),
    ),
    updateMessage: vi.fn<UpdateFn>(
      overrides.updateMessage ?? (async () => ({ ok: true as const })),
    ),
    readMessageMetadata: vi.fn<ReadFn>(
      overrides.readMessageMetadata ??
        (async () => ({
          ok: true as const,
          metadata: {
            event_type: RUN_TIMELINE_EVENT_TYPE,
            event_payload: EXISTING as unknown as Record<string, unknown>,
          },
        })),
    ),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("startTimeline", () => {
  it("posts_started_timeline_with_metadata_and_returns_ref", async () => {
    const deps = makeDeps();

    const ref = await startTimeline(
      { channel: "C1", threadTs: "50.5", agent: "health", title: "Health agent", runId: "run-1", at: 1000 },
      deps,
    );

    expect(ref).toEqual({ channel: "C1", ts: "100.1" });
    const params = deps.postMessage.mock.calls[0]![0];
    expect(params.channel).toBe("C1");
    expect(params.threadTs).toBe("50.5");
    expect(params.blocks?.length).toBeGreaterThan(0);
    expect(params.metadata?.event_type).toBe(RUN_TIMELINE_EVENT_TYPE);
    expect(params.metadata?.event_payload).toEqual(EXISTING);
  });

  it("returns_null_on_post_failure", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const deps = makeDeps({
      postMessage: (async () => ({ ok: false as const, error: "channel_not_found" })),
    });

    const ref = await startTimeline(
      { channel: "C1", agent: "health", title: "t", runId: "r" },
      deps,
    );

    expect(ref).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it("returns_null_when_post_throws", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const deps = makeDeps({
      postMessage: (async () => {
        throw new Error("SLACK_BOT_TOKEN is not set");
      }),
    });

    await expect(
      startTimeline({ channel: "C1", agent: "health", title: "t", runId: "r" }, deps),
    ).resolves.toBeNull();
  });
});

describe("appendRunEvent", () => {
  it("reads_appends_and_updates_with_metadata", async () => {
    const deps = makeDeps();

    const ok = await appendRunEvent(
      REF,
      { kind: "findings", at: 1060, total: 3, repairable: 1, reportOnly: 2 },
      deps,
    );

    expect(ok).toBe(true);
    expect(deps.readMessageMetadata).toHaveBeenCalledWith(REF);
    const params = deps.updateMessage.mock.calls[0]![0];
    expect(params.channel).toBe("C1");
    expect(params.ts).toBe("100.1");
    expect(params.text).toContain("Findings gathered");
    expect(params.metadata?.event_type).toBe(RUN_TIMELINE_EVENT_TYPE);
    expect((params.metadata?.event_payload as RunTimeline).events).toEqual([
      { kind: "started", at: 1000 },
      { kind: "findings", at: 1060, total: 3, repairable: 1, reportOnly: 2 },
    ]);
  });

  it("returns_false_when_read_fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const deps = makeDeps({
      readMessageMetadata: (async () => ({ ok: false as const, error: "missing_scope" })),
    });

    await expect(appendRunEvent(REF, { kind: "completed", at: 2000 }, deps)).resolves.toBe(false);
    expect(deps.updateMessage).not.toHaveBeenCalled();
    expect(warn.mock.calls[0]![0]).toContain("[run-timeline]");
  });

  it("returns_false_when_read_throws", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const deps = makeDeps({
      readMessageMetadata: (async () => {
        throw new Error("network");
      }),
    });

    await expect(appendRunEvent(REF, { kind: "completed", at: 2000 }, deps)).resolves.toBe(false);
  });

  it("returns_false_when_metadata_missing", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const deps = makeDeps({
      readMessageMetadata: (async () => ({ ok: true as const, metadata: null })),
    });

    await expect(appendRunEvent(REF, { kind: "completed", at: 2000 }, deps)).resolves.toBe(false);
    expect(deps.updateMessage).not.toHaveBeenCalled();
  });

  it("returns_false_when_metadata_is_another_event_type", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const deps = makeDeps({
      readMessageMetadata: (async () => ({
        ok: true as const,
        metadata: { event_type: "something_else", event_payload: EXISTING },
      })),
    });

    await expect(appendRunEvent(REF, { kind: "completed", at: 2000 }, deps)).resolves.toBe(false);
    expect(deps.updateMessage).not.toHaveBeenCalled();
  });

  it("returns_false_when_payload_shape_is_invalid", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const deps = makeDeps({
      readMessageMetadata: (async () => ({
        ok: true as const,
        metadata: {
          event_type: RUN_TIMELINE_EVENT_TYPE,
          event_payload: { agent: "health", events: "nope" },
        },
      })),
    });

    await expect(appendRunEvent(REF, { kind: "completed", at: 2000 }, deps)).resolves.toBe(false);
    expect(deps.updateMessage).not.toHaveBeenCalled();
  });

  it("returns_false_when_update_fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const deps = makeDeps({
      updateMessage: (async () => ({ ok: false as const, error: "message_not_found" })),
    });

    await expect(appendRunEvent(REF, { kind: "completed", at: 2000 }, deps)).resolves.toBe(false);
  });
});
