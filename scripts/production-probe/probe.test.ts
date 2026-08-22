import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  classifyHealthResult,
  evaluateProbe,
  main,
  readState,
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

const ALL_DOWN: CheckResult[] = [
  check("home", 500, false),
  check("brands", 500, false),
  check("health", 500, false),
  check("supabase", 500, false),
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

  it("evaluateProbe separates hard failures from maintenance-gated checks", () => {
    const evaluation = evaluateProbe([
      check("home", 503, false, MAINTENANCE_BODY),
      check("brands", 503, false, MAINTENANCE_BODY),
      check("health", 503, false, MAINTENANCE_BODY),
      check("supabase", 500, false),
    ]);

    expect(evaluation.verdict).toBe("down");
    expect(evaluation.failed).toHaveLength(4);
    expect(evaluation.hardFailures.map((result) => result.id)).toEqual([
      "supabase",
    ]);
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
    // A healthy or gated first run has no transition to report.
    const healthy = shouldNotify(evaluateProbe(ALL_OK), null, now);
    expect(healthy.kind).toBeNull();
    expect(healthy.state.verdict).toBe("ok");

    const gated = shouldNotify(
      evaluateProbe([
        check("home", 503, false, MAINTENANCE_BODY),
        check("brands", 503, false, MAINTENANCE_BODY),
        check("health", 503, false, MAINTENANCE_BODY),
        check("supabase", 200, true),
      ]),
      null,
      now,
    );
    expect(gated.kind).toBeNull();
    expect(gated.state.verdict).toBe("gated");

    // A first run that finds production down must still alarm: recording it
    // silently would make every later run see an unchanged verdict.
    const decision = shouldNotify(evaluateProbe(ALL_DOWN), null, now);

    expect(decision.kind).toBe("down");
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

  it("shouldNotify makes up a heartbeat that is more than a day stale", () => {
    const evaluation = evaluateProbe(ALL_OK);
    const previous = state("ok", "2026-08-20T00:00:00.000Z", "2026-08-22");

    // Two days later, hours before the evening window: the missed day must not
    // pass unrecorded, because a silent channel has to mean a dead watcher.
    const madeUp = shouldNotify(
      evaluation,
      previous,
      new Date("2026-08-24T03:00:00.000Z"),
    );
    expect(madeUp.kind).toBe("heartbeat");
    expect(madeUp.state.lastHeartbeatDate).toBe("2026-08-24");

    // Still exactly one per calendar day.
    expect(
      shouldNotify(evaluation, madeUp.state, new Date("2026-08-24T04:00:00.000Z"))
        .kind,
    ).toBeNull();
    expect(
      shouldNotify(evaluation, madeUp.state, new Date("2026-08-24T21:00:00.000Z"))
        .kind,
    ).toBeNull();
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

describe("readState", () => {
  const directory = mkdtempSync(join(tmpdir(), "probe-readstate-"));

  function writeRaw(name: string, raw: string): string {
    const path = join(directory, name);
    writeFileSync(path, raw);
    return path;
  }

  it("readState treats a missing since as no previous state", () => {
    expect(
      readState(writeRaw("no-since.json", JSON.stringify({ verdict: "down" }))),
    ).toBeNull();
    expect(
      readState(
        writeRaw(
          "numeric-since.json",
          JSON.stringify({ since: 0, verdict: "down" }),
        ),
      ),
    ).toBeNull();
  });

  it("readState accepts a well-formed state", () => {
    const path = writeRaw(
      "good.json",
      JSON.stringify({
        lastHeartbeatDate: "2026-08-22",
        since: "2026-08-22T10:00:00.000Z",
        verdict: "gated",
      }),
    );

    expect(readState(path)).toEqual({
      lastHeartbeatDate: "2026-08-22",
      since: "2026-08-22T10:00:00.000Z",
      verdict: "gated",
    });
  });
});

describe("classifyHealthResult", () => {
  it("classifyHealthResult names a degraded rate limiter", () => {
    const classified = classifyHealthResult(
      check("health", 200, true, JSON.stringify({ rateLimitStore: "degraded" })),
    );

    expect(classified.ok).toBe(false);
    expect(classified.reason).toBe("rate limiter degraded");
  });

  it("classifyHealthResult names an unreadable body separately", () => {
    const unparseable = classifyHealthResult(check("health", 200, true, ""));
    expect(unparseable.ok).toBe(false);
    expect(unparseable.reason).toBe("health body unreadable");

    const notJson = classifyHealthResult(
      check("health", 200, true, "<html>gateway</html>"),
    );
    expect(notJson.ok).toBe(false);
    expect(notJson.reason).toBe("health body unreadable");

    const transportFailure = classifyHealthResult({
      ...check("health", 200, true, ""),
      reason: "response body unreadable",
    });
    expect(transportFailure.ok).toBe(false);
    expect(transportFailure.reason).toBe("response body unreadable");
  });

  it("classifyHealthResult leaves a healthy body alone", () => {
    const healthy = check(
      "health",
      200,
      true,
      JSON.stringify({ rateLimitStore: "ready" }),
    );

    expect(classifyHealthResult(healthy)).toEqual(healthy);
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

  it("renderMessage names only the hard failures while the site is gated", () => {
    const evaluation = evaluateProbe([
      check("home", 503, false, MAINTENANCE_BODY),
      check("brands", 503, false, MAINTENANCE_BODY),
      check("health", 503, false, MAINTENANCE_BODY),
      check("supabase", 500, false),
    ]);

    const message = renderMessage({
      evaluation,
      kind: "down",
      now: new Date("2026-08-22T12:00:00.000Z"),
      previous: state("gated", "2026-08-22T00:00:00.000Z"),
    });

    expect(message).toContain("supabase");
    expect(message).toContain("1/4");
    expect(message).not.toContain("home");
    expect(message).not.toContain("brands");
    expect(message).not.toContain("503");
  });

  it("renderMessage explains a degraded health check that returned 200", () => {
    const evaluation = evaluateProbe([
      check("home", 200, true),
      check("brands", 200, true),
      classifyHealthResult(
        check(
          "health",
          200,
          true,
          JSON.stringify({ rateLimitStore: "degraded" }),
        ),
      ),
      check("supabase", 200, true),
    ]);

    const message = renderMessage({
      evaluation,
      kind: "down",
      now: new Date("2026-08-22T12:00:00.000Z"),
      previous: state("ok", "2026-08-22T00:00:00.000Z"),
    });

    expect(message).toContain("health — 200 (rate limiter degraded)");
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

  it("renderMessage does not declare recovery when down becomes gated", () => {
    const gated = evaluateProbe([
      check("home", 503, false, MAINTENANCE_BODY),
      check("brands", 503, false, MAINTENANCE_BODY),
      check("health", 503, false, MAINTENANCE_BODY),
      check("supabase", 200, true),
    ]);
    const previous = state("down", "2026-08-22T10:30:00.000Z");
    const now = new Date("2026-08-22T12:00:00.000Z");

    const decision = shouldNotify(gated, previous, now);
    expect(decision.kind).toBe("recovered");

    const message = renderMessage({
      evaluation: gated,
      kind: decision.kind ?? "recovered",
      now,
      previous,
    });

    expect(message).not.toContain("recovered");
    expect(message).not.toContain("✅");
    expect(message).toContain("maintenance page");
    expect(message).toContain("not serving");
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

// ── main(): the side-effecting layer ─────────────────────────────────────────

const WEBHOOK_URL = "https://hooks.test/webhook";
const BASE_URL = "https://production.test";
const SUPABASE_URL = "https://supabase.test";

const ENV = {
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
  PRODUCTION_BASE_URL: BASE_URL,
  SLACK_HEALTH_WEBHOOK_URL: WEBHOOK_URL,
} as const;

const HEALTHY_HEALTH_BODY = JSON.stringify({ rateLimitStore: "ready" });

interface StubResponse {
  body?: string;
  status: number;
}

function stubFetch(
  route: (url: string) => StubResponse,
  calls: string[],
): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : String(input);
    calls.push(url);
    const { body = "", status } = route(url);
    return new Response(body, { status });
  }) as unknown as typeof fetch;
}

function healthyRoute(url: string): StubResponse {
  if (url.includes("/api/health")) {
    return { body: HEALTHY_HEALTH_BODY, status: 200 };
  }
  return { body: "ok", status: 200 };
}

describe("main", () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "probe-main-"));
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function statePath(name = "state.json"): string {
    return join(directory, name);
  }

  function seed(path: string, value: ProbeState): void {
    writeFileSync(path, JSON.stringify(value));
  }

  function readBack(path: string): ProbeState {
    return JSON.parse(readFileSync(path, "utf8")) as ProbeState;
  }

  it("main persists the new verdict even when the Slack webhook fails", async () => {
    const path = statePath();
    seed(path, state("ok", "2026-08-22T00:00:00.000Z"));
    const calls: string[] = [];
    // Production is down AND the webhook itself answers 500.
    const fetchImpl = stubFetch(() => ({ status: 500 }), calls);

    await expect(
      main({
        argv: ["node", "probe.ts", path],
        env: ENV,
        fetchImpl,
        now: () => new Date("2026-08-22T12:00:00.000Z"),
        sleep: async () => undefined,
      }),
    ).rejects.toThrow(/Slack webhook returned HTTP 500/);

    expect(calls.filter((url) => url.startsWith(WEBHOOK_URL))).toHaveLength(1);
    expect(readBack(path).verdict).toBe("down");
    expect(readBack(path).since).toBe("2026-08-22T12:00:00.000Z");
  });

  it("main sends nothing when one failing attempt is followed by passing retries", async () => {
    const path = statePath();
    seed(path, state("ok", "2026-08-22T00:00:00.000Z"));
    const calls: string[] = [];
    let homeAttempts = 0;
    const fetchImpl = stubFetch((url) => {
      if (url === `${BASE_URL}/`) {
        homeAttempts += 1;
        return homeAttempts === 1 ? { status: 502 } : { body: "ok", status: 200 };
      }
      return healthyRoute(url);
    }, calls);

    const decision = await main({
      argv: ["node", "probe.ts", path],
      env: ENV,
      fetchImpl,
      now: () => new Date("2026-08-22T12:00:00.000Z"),
      sleep: async () => undefined,
    });

    expect(decision.kind).toBeNull();
    expect(decision.state.verdict).toBe("ok");
    expect(calls.filter((url) => url.startsWith(WEBHOOK_URL))).toHaveLength(0);
    expect(homeAttempts).toBe(2);
    expect(readBack(path).verdict).toBe("ok");
  });

  it("main alarms on a first run that finds production down", async () => {
    const path = statePath("fresh.json");
    const calls: string[] = [];
    const fetchImpl = stubFetch(
      (url) => (url.startsWith(WEBHOOK_URL) ? { status: 200 } : { status: 503 }),
      calls,
    );

    const decision = await main({
      argv: ["node", "probe.ts", path],
      env: ENV,
      fetchImpl,
      now: () => new Date("2026-08-22T12:00:00.000Z"),
      sleep: async () => undefined,
    });

    expect(decision.kind).toBe("down");
    expect(calls.filter((url) => url.startsWith(WEBHOOK_URL))).toHaveLength(1);
    expect(readBack(path).verdict).toBe("down");
  });

  it("main resolves the state path from argv, then from the environment", async () => {
    const fromArgv = statePath("argv.json");
    const fromEnv = statePath("env.json");
    const calls: string[] = [];
    const fetchImpl = stubFetch(healthyRoute, calls);
    const now = () => new Date("2026-08-22T12:00:00.000Z");

    await main({
      argv: ["node", "probe.ts", fromArgv],
      env: { ...ENV, PROBE_STATE_PATH: fromEnv },
      fetchImpl,
      now,
      sleep: async () => undefined,
    });

    expect(existsSync(fromArgv)).toBe(true);
    expect(existsSync(fromEnv)).toBe(false);

    await main({
      argv: ["node", "probe.ts"],
      env: { ...ENV, PROBE_STATE_PATH: fromEnv },
      fetchImpl,
      now,
      sleep: async () => undefined,
    });

    expect(readBack(fromEnv).verdict).toBe("ok");
  });

  it("main sends a browser User-Agent on every request", async () => {
    const path = statePath("agent.json");
    const headers: (string | null)[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const requestHeaders = new Headers(init?.headers);
      headers.push(requestHeaders.get("User-Agent"));
      return new Response(
        String(input).includes("/api/health") ? HEALTHY_HEALTH_BODY : "ok",
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    await main({
      argv: ["node", "probe.ts", path],
      env: ENV,
      fetchImpl,
      now: () => new Date("2026-08-22T12:00:00.000Z"),
      sleep: async () => undefined,
    });

    expect(headers).toHaveLength(4);
    for (const value of headers) {
      expect(value).toMatch(/^Mozilla\/5\.0 /);
    }
  });
});
