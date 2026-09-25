import {
  postMessage,
  readMessageMetadata,
  updateMessage,
} from "@/lib/adapters/slack/web-api";
import { renderTimeline } from "./render";
import {
  RUN_EVENT_KINDS,
  RUN_TIMELINE_EVENT_TYPE,
  type RunEvent,
  type RunTimeline,
  type TimelineRef,
} from "./types";

export type TimelineDeps = {
  postMessage: typeof postMessage;
  updateMessage: typeof updateMessage;
  readMessageMetadata: typeof readMessageMetadata;
};

const defaultDeps: TimelineDeps = { postMessage, updateMessage, readMessageMetadata };

export type StartTimelineInput = {
  channel: string;
  threadTs?: string;
  agent: string;
  title: string;
  runId: string;
  /** Epoch seconds; defaults to now. */
  at?: number;
};

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function toMetadata(timeline: RunTimeline) {
  return {
    event_type: RUN_TIMELINE_EVENT_TYPE,
    event_payload: timeline as unknown as Record<string, unknown>,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRunEvent(value: unknown): value is RunEvent {
  return (
    isRecord(value) &&
    typeof value.at === "number" &&
    typeof value.kind === "string" &&
    (RUN_EVENT_KINDS as readonly string[]).includes(value.kind)
  );
}

function parseTimeline(payload: unknown): RunTimeline | null {
  if (!isRecord(payload)) return null;
  const { agent, title, runId, events } = payload;
  if (typeof agent !== "string" || typeof title !== "string" || typeof runId !== "string") {
    return null;
  }
  if (!Array.isArray(events) || !events.every(isRunEvent)) return null;
  return { agent, title, runId, events: [...events] };
}

export async function startTimeline(
  input: StartTimelineInput,
  deps: TimelineDeps = defaultDeps,
): Promise<TimelineRef | null> {
  const timeline: RunTimeline = {
    agent: input.agent,
    title: input.title,
    runId: input.runId,
    events: [{ kind: "started", at: input.at ?? nowSeconds() }],
  };
  try {
    const { text, blocks } = renderTimeline(timeline);
    const result = await deps.postMessage({
      channel: input.channel,
      threadTs: input.threadTs,
      text,
      blocks,
      metadata: toMetadata(timeline),
    });
    if (!result.ok) {
      console.warn(`[run-timeline] start failed for ${input.runId}: ${result.error}`);
      return null;
    }
    return { channel: input.channel, ts: result.ts };
  } catch (error) {
    console.warn(`[run-timeline] start threw for ${input.runId}: ${errorMessage(error)}`);
    return null;
  }
}

// shortcut: read-append-update with no lock. Writers take turns (agent -> ops-agent -> routine), so overlap is rare; two simultaneous writers can drop an event. Upgrade path: an agent_run_events table.
export async function appendRunEvent(
  ref: TimelineRef,
  event: RunEvent,
  deps: TimelineDeps = defaultDeps,
): Promise<boolean> {
  const where = `${ref.channel}/${ref.ts}`;
  try {
    const read = await deps.readMessageMetadata({ channel: ref.channel, ts: ref.ts });
    if (!read.ok) {
      console.warn(`[run-timeline] read failed for ${where}: ${read.error}`);
      return false;
    }
    if (!read.metadata || read.metadata.event_type !== RUN_TIMELINE_EVENT_TYPE) {
      console.warn(`[run-timeline] no run-timeline metadata on ${where}; skipping ${event.kind}`);
      return false;
    }
    const timeline = parseTimeline(read.metadata.event_payload);
    if (!timeline) {
      console.warn(`[run-timeline] malformed run-timeline payload on ${where}; skipping ${event.kind}`);
      return false;
    }

    timeline.events.push(event);
    const { text, blocks } = renderTimeline(timeline);
    const update = await deps.updateMessage({
      channel: ref.channel,
      ts: ref.ts,
      text,
      blocks,
      metadata: toMetadata(timeline),
    });
    if (!update.ok) {
      console.warn(`[run-timeline] update failed for ${where}: ${update.error}`);
      return false;
    }
    return true;
  } catch (error) {
    console.warn(`[run-timeline] append threw for ${where}: ${errorMessage(error)}`);
    return false;
  }
}
