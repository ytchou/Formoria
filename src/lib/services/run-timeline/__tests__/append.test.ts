import { afterEach, describe, expect, it, vi } from "vitest";
import { appendRunEvent, startTimeline, type TimelineDeps } from "../append";
import { RUN_TIMELINE_EVENT_TYPE, type RunTimeline } from "../types";

const REF = { channel: "C0BJ6TWPDF1", ts: "1790309764.000200" };

const EXISTING: RunTimeline = {
  agent: "health",
  title: "Health agent",
  runId: "run-2026-09-25-nightly",
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
      overrides.postMessage ?? (async () => ({ ok: true as const, ts: "1790309764.000200" })),
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
  it("posts a running timeline carrying its metadata and returns where it lives", async () => {
    const deps = makeDeps();

    const ref = await startTimeline(
      {
        channel: "C0BJ6TWPDF1",
        threadTs: "1790309700.000100",
        agent: "health",
        title: "Health agent",
        runId: "run-2026-09-25-nightly",
        at: 1000,
      },
      deps,
    );

    expect(ref).toEqual(REF);
    const params = deps.postMessage.mock.calls[0]![0];
    expect(params.channel).toBe("C0BJ6TWPDF1");
    expect(params.threadTs).toBe("1790309700.000100");
    expect(params.blocks?.length).toBeGreaterThan(0);
    expect(params.metadata?.event_type).toBe(RUN_TIMELINE_EVENT_TYPE);
    expect(params.metadata?.event_payload).toEqual(EXISTING);
  });

  it("gives no timeline when Slack rejects the post", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const deps = makeDeps({
      postMessage: (async () => ({ ok: false as const, error: "channel_not_found" })),
    });

    const ref = await startTimeline(
      { channel: "C0BJ6TWPDF1", agent: "health", title: "Health agent", runId: "run-2026-09-25-nightly" },
      deps,
    );

    expect(ref).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it("gives no timeline when posting throws", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const deps = makeDeps({
      postMessage: (async () => {
        throw new Error("SLACK_BOT_TOKEN is not set");
      }),
    });

    await expect(
      startTimeline(
        { channel: "C0BJ6TWPDF1", agent: "health", title: "Health agent", runId: "run-2026-09-25-nightly" },
        deps,
      ),
    ).resolves.toBeNull();
  });
});

describe("appendRunEvent", () => {
  it("keeps earlier events when a new event is appended", async () => {
    const deps = makeDeps();

    const ok = await appendRunEvent(
      REF,
      { kind: "findings", at: 1060, total: 3, repairable: 1, reportOnly: 2 },
      deps,
    );

    expect(ok).toBe(true);
    expect(deps.readMessageMetadata).toHaveBeenCalledWith(REF);
    const params = deps.updateMessage.mock.calls[0]![0];
    expect(params.channel).toBe(REF.channel);
    expect(params.ts).toBe(REF.ts);
    expect(params.text).toContain("Findings gathered");
    expect(params.metadata?.event_type).toBe(RUN_TIMELINE_EVENT_TYPE);
    expect((params.metadata?.event_payload as RunTimeline).events).toEqual([
      { kind: "started", at: 1000 },
      { kind: "findings", at: 1060, total: 3, repairable: 1, reportOnly: 2 },
    ]);
  });

  it("does not duplicate a retried pr_opened that differs only in its timestamp", async () => {
    const pr = {
      kind: "pr_opened" as const,
      number: 1252,
      url: "https://github.com/ytchou/Formoria/pull/1252",
      title: "fix(DEV-2041): guard empty brand list",
      ticketId: "DEV-2041",
    };
    const deps = makeDeps({
      readMessageMetadata: async () => ({
        ok: true as const,
        metadata: {
          event_type: RUN_TIMELINE_EVENT_TYPE,
          event_payload: {
            ...EXISTING,
            events: [...EXISTING.events, { ...pr, at: 1200 }],
          } as unknown as Record<string, unknown>,
        },
      }),
    });

    const ok = await appendRunEvent(REF, { ...pr, at: 1215 }, deps);

    expect(ok).toBe(true);
    expect(deps.updateMessage).not.toHaveBeenCalled();
  });

  it("still appends an event that differs from the ones already on the timeline", async () => {
    const pr = {
      kind: "pr_opened" as const,
      number: 1252,
      url: "https://github.com/ytchou/Formoria/pull/1252",
      title: "fix(DEV-2041): guard empty brand list",
    };
    const deps = makeDeps({
      readMessageMetadata: async () => ({
        ok: true as const,
        metadata: {
          event_type: RUN_TIMELINE_EVENT_TYPE,
          event_payload: {
            ...EXISTING,
            events: [...EXISTING.events, { ...pr, at: 1200 }],
          } as unknown as Record<string, unknown>,
        },
      }),
    });

    const ok = await appendRunEvent(REF, { ...pr, number: 1253, at: 1215 }, deps);

    expect(ok).toBe(true);
    const params = deps.updateMessage.mock.calls[0]![0];
    expect((params.metadata?.event_payload as RunTimeline).events).toEqual([
      { kind: "started", at: 1000 },
      { ...pr, at: 1200 },
      { ...pr, number: 1253, at: 1215 },
    ]);
  });

  it("reports a failed append when the timeline cannot be read", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const deps = makeDeps({
      readMessageMetadata: (async () => ({ ok: false as const, error: "missing_scope" })),
    });

    await expect(appendRunEvent(REF, { kind: "completed", at: 2000 }, deps)).resolves.toBe(false);
    expect(deps.updateMessage).not.toHaveBeenCalled();
    expect(warn.mock.calls[0]![0]).toContain("[run-timeline]");
  });

  it("reports a failed append when reading throws", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const deps = makeDeps({
      readMessageMetadata: (async () => {
        throw new Error("fetch failed: ECONNRESET");
      }),
    });

    await expect(appendRunEvent(REF, { kind: "completed", at: 2000 }, deps)).resolves.toBe(false);
  });

  it("leaves a message without timeline metadata untouched", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const deps = makeDeps({
      readMessageMetadata: (async () => ({ ok: true as const, metadata: null })),
    });

    await expect(appendRunEvent(REF, { kind: "completed", at: 2000 }, deps)).resolves.toBe(false);
    expect(deps.updateMessage).not.toHaveBeenCalled();
  });

  it("leaves a message with another metadata type untouched", async () => {
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

  it("leaves a malformed timeline payload untouched", async () => {
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

  it("reports a failed append when Slack rejects the update", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const deps = makeDeps({
      updateMessage: (async () => ({ ok: false as const, error: "message_not_found" })),
    });

    await expect(appendRunEvent(REF, { kind: "completed", at: 2000 }, deps)).resolves.toBe(false);
  });
});
