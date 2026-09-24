import { describe, expect, it } from "vitest";

import {
  PENDING_LEASE_MS,
  RUNNING_LEASE_MS,
  isInFlight,
  threadLink,
  toDispatch,
} from "../dispatches";

const NOW = new Date("2026-09-24T12:00:00Z");

function minutesBefore(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60_000).toISOString();
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "req-1",
    channel_id: "C_OPS",
    thread_ts: "1727179200.123456",
    slack_user_id: "U_REQ",
    dispatched_at: null as string | null,
    dispatch_claimed_at: null as string | null,
    dispatch_run_id: null as string | null,
    dispatch_completed_at: null as string | null,
    ...overrides,
  };
}

describe("toDispatch", () => {
  it("maps a snake_case row to the camelCase dispatch", () => {
    const row = makeRow({
      dispatch_run_id: "run-1",
      dispatch_claimed_at: "2026-09-24T11:55:00Z",
    });

    expect(toDispatch(row)).toEqual({
      id: "req-1",
      channelId: "C_OPS",
      threadTs: "1727179200.123456",
      requesterId: "U_REQ",
      runId: "run-1",
      claimedAt: "2026-09-24T11:55:00Z",
    });
  });

  it("uses slack_user_id as requesterId", () => {
    expect(toDispatch(makeRow({ slack_user_id: "U_OTHER" })).requesterId).toBe(
      "U_OTHER",
    );
  });
});

describe("isInFlight", () => {
  it("is false when never dispatched", () => {
    expect(isInFlight(makeRow(), NOW)).toBe(false);
  });

  it("pending dispatch younger than the pending lease is in flight", () => {
    expect(isInFlight(makeRow({ dispatched_at: minutesBefore(9) }), NOW)).toBe(
      true,
    );
  });

  it("pending dispatch at or past the pending lease is not in flight", () => {
    expect(PENDING_LEASE_MS).toBe(10 * 60_000);
    expect(isInFlight(makeRow({ dispatched_at: minutesBefore(10) }), NOW)).toBe(
      false,
    );
    expect(isInFlight(makeRow({ dispatched_at: minutesBefore(30) }), NOW)).toBe(
      false,
    );
  });

  it("claimed, not completed, younger than the running lease is in flight", () => {
    const row = makeRow({
      dispatched_at: minutesBefore(45),
      dispatch_claimed_at: minutesBefore(39),
    });
    expect(isInFlight(row, NOW)).toBe(true);
  });

  it("claimed at or past the running lease is not in flight", () => {
    expect(RUNNING_LEASE_MS).toBe(40 * 60_000);
    const row = makeRow({
      dispatched_at: minutesBefore(50),
      dispatch_claimed_at: minutesBefore(40),
    });
    expect(isInFlight(row, NOW)).toBe(false);
  });

  it("completed dispatch is not in flight", () => {
    const row = makeRow({
      dispatched_at: minutesBefore(5),
      dispatch_claimed_at: minutesBefore(4),
      dispatch_completed_at: minutesBefore(1),
    });
    expect(isInFlight(row, NOW)).toBe(false);
  });
});

describe("threadLink", () => {
  it("builds a Slack archive permalink with the dot removed from ts", () => {
    expect(threadLink("C_OPS", "1727179200.123456")).toBe(
      "https://slack.com/archives/C_OPS/p1727179200123456",
    );
  });
});
