import { describe, expect, it } from "vitest";

import {
  evaluateProbe,
  renderMessage,
  shouldNotify,
  type CheckResult,
  type ProbeState,
} from "./probe";

function check(
  id: string,
  status: number | null,
  ok: boolean,
  body = "",
): CheckResult {
  return { body, id, ok, status };
}

const ALL_OK: CheckResult[] = [
  check("home", 200, true),
  check("brands", 200, true),
  check("health", 200, true),
  check("supabase", 200, true),
];

const MAINTENANCE_BODY = JSON.stringify({ error: "service_unavailable" });

function state(
  verdict: ProbeState["verdict"],
  since: string,
  lastHeartbeatDate: string | null = null,
): ProbeState {
  return { lastHeartbeatDate, since, verdict };
}

describe("evaluateProbe", () => {
  it("evaluateProbe returns down when every check fails", () => {
    const evaluation = evaluateProbe([
      check("home", 500, false),
      check("brands", 500, false),
      check("health", 500, false),
      check("supabase", 500, false),
    ]);

    expect(evaluation.verdict).toBe("down");
    expect(evaluation.failed.map((result) => result.id)).toEqual([
      "home",
      "brands",
      "health",
      "supabase",
    ]);
  });

  it("evaluateProbe returns ok when every check passes", () => {
    const evaluation = evaluateProbe(ALL_OK);

    expect(evaluation.verdict).toBe("ok");
    expect(evaluation.failed).toEqual([]);
    expect(evaluation.checkCount).toBe(4);
  });

  it("evaluateProbe classifies the maintenance gate as gated, not down", () => {
    const gated = evaluateProbe([
      check("home", 503, false, MAINTENANCE_BODY),
      check("brands", 503, false, MAINTENANCE_BODY),
      check("health", 503, false, MAINTENANCE_BODY),
      check("supabase", 200, true),
    ]);
    expect(gated.verdict).toBe("gated");

    const down = evaluateProbe([
      check("home", 503, false, "<html>upstream boom</html>"),
      check("brands", 200, true),
      check("health", 200, true),
      check("supabase", 200, true),
    ]);
    expect(down.verdict).toBe("down");
  });

  it("evaluateProbe reports a partial failure as down and names only the failing check", () => {
    const evaluation = evaluateProbe([
      check("home", 200, true),
      check("brands", 502, false),
      check("health", 200, true),
      check("supabase", 200, true),
    ]);

    expect(evaluation.verdict).toBe("down");
    expect(evaluation.failed.map((result) => result.id)).toEqual(["brands"]);
  });
});

describe("shouldNotify", () => {
  const now = new Date("2026-08-22T12:00:00.000Z");

  it("shouldNotify fires on ok to down transition", () => {
    const decision = shouldNotify(
      evaluateProbe([
        check("home", 500, false),
        check("brands", 500, false),
        check("health", 500, false),
        check("supabase", 500, false),
      ]),
      state("ok", "2026-08-22T00:00:00.000Z"),
      now,
    );

    expect(decision.kind).toBe("down");
    expect(decision.state.verdict).toBe("down");
    expect(decision.state.since).toBe(now.toISOString());
  });

  it("shouldNotify fires on down to ok transition", () => {
    const decision = shouldNotify(
      evaluateProbe(ALL_OK),
      state("down", "2026-08-22T10:00:00.000Z"),
      now,
    );

    expect(decision.kind).toBe("recovered");
    expect(decision.state.verdict).toBe("ok");
  });

  it("shouldNotify is silent when the verdict is unchanged", () => {
    expect(
      shouldNotify(
        evaluateProbe(ALL_OK),
        state("ok", "2026-08-22T00:00:00.000Z"),
        now,
      ).kind,
    ).toBeNull();

    const downEvaluation = evaluateProbe([
      check("home", 500, false),
      check("brands", 500, false),
      check("health", 500, false),
      check("supabase", 500, false),
    ]);
    expect(
      shouldNotify(
        downEvaluation,
        state("down", "2026-08-22T00:00:00.000Z"),
        now,
      ).kind,
    ).toBeNull();
  });

  it("shouldNotify does not alarm on the first run", () => {
    const decision = shouldNotify(
      evaluateProbe([
        check("home", 500, false),
        check("brands", 500, false),
        check("health", 500, false),
        check("supabase", 500, false),
      ]),
      null,
      now,
    );

    expect(decision.kind).toBeNull();
    expect(decision.state.verdict).toBe("down");
  });

  it("shouldNotify emits the heartbeat once per calendar day", () => {
    const evaluation = evaluateProbe(ALL_OK);
    const before = new Date("2026-08-22T20:30:00.000Z");
    const at = new Date("2026-08-22T21:00:00.000Z");
    const later = new Date("2026-08-22T21:30:00.000Z");
    const nextDay = new Date("2026-08-23T21:00:00.000Z");
    const previous = state("ok", "2026-08-20T00:00:00.000Z");

    expect(shouldNotify(evaluation, previous, before).kind).toBeNull();

    const first = shouldNotify(evaluation, previous, at);
    expect(first.kind).toBe("heartbeat");
    expect(first.state.lastHeartbeatDate).toBe("2026-08-22");

    expect(shouldNotify(evaluation, first.state, later).kind).toBeNull();

    const second = shouldNotify(evaluation, first.state, nextDay);
    expect(second.kind).toBe("heartbeat");
    expect(second.state.lastHeartbeatDate).toBe("2026-08-23");
  });

  it("shouldNotify does not emit a heartbeat while down", () => {
    const evaluation = evaluateProbe([
      check("home", 500, false),
      check("brands", 500, false),
      check("health", 500, false),
      check("supabase", 500, false),
    ]);

    const decision = shouldNotify(
      evaluation,
      state("down", "2026-08-22T02:00:00.000Z"),
      new Date("2026-08-22T21:00:00.000Z"),
    );

    expect(decision.kind).toBeNull();
    expect(decision.state.lastHeartbeatDate).toBeNull();
  });
});

describe("renderMessage", () => {
  it("renderMessage names the failing checks", () => {
    const evaluation = evaluateProbe([
      check("home", 200, true),
      check("brands", 502, false),
      check("health", 500, false),
      check("supabase", 200, true),
    ]);

    const message = renderMessage({
      evaluation,
      kind: "down",
      now: new Date("2026-08-22T12:00:00.000Z"),
      previous: state("ok", "2026-08-22T00:00:00.000Z"),
    });

    expect(message).toContain("brands");
    expect(message).toContain("502");
    expect(message).toContain("health");
    expect(message).toContain("500");
    expect(message).not.toContain("supabase");
  });

  it("renderMessage is bounded", () => {
    const failing = Array.from({ length: 400 }, (_, index) =>
      check(`check-${index}-${"x".repeat(40)}`, 500, false),
    );

    const message = renderMessage({
      evaluation: evaluateProbe(failing),
      kind: "down",
      now: new Date("2026-08-22T12:00:00.000Z"),
      previous: state("ok", "2026-08-22T00:00:00.000Z"),
    });

    expect(Array.from(message).length).toBeLessThanOrEqual(2999);
  });

  it("renderMessage reports the outage duration on recovery", () => {
    const message = renderMessage({
      evaluation: evaluateProbe(ALL_OK),
      kind: "recovered",
      now: new Date("2026-08-22T12:00:00.000Z"),
      previous: state("down", "2026-08-22T10:30:00.000Z"),
    });

    expect(message).toContain("recovered");
    expect(message).toContain("1h30m");
  });

  it("renderMessage states the check count and gate status in the heartbeat", () => {
    const gated = evaluateProbe([
      check("home", 503, false, MAINTENANCE_BODY),
      check("brands", 503, false, MAINTENANCE_BODY),
      check("health", 503, false, MAINTENANCE_BODY),
      check("supabase", 200, true),
    ]);

    const message = renderMessage({
      evaluation: gated,
      kind: "heartbeat",
      now: new Date("2026-08-22T21:00:00.000Z"),
      previous: state("gated", "2026-08-20T00:00:00.000Z"),
    });

    expect(message).toContain("4");
    expect(message).toContain("gated");
  });
});
