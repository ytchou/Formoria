import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRunTimelineHandler, type RunTimelineRouteDeps } from "./route";

const TOKEN = "routine-callback-token";
const URL = "http://localhost/api/internal/run-timeline";
const BODY = { channel: "C0ALERTS", ts: "1727200000.000100", event: { kind: "completed" } };

type Apply = RunTimelineRouteDeps["applyRoutineTimelineEvent"];

function makeDeps(result: Awaited<ReturnType<Apply>> = { ok: true, appended: true, recorded: 0 }) {
  return { applyRoutineTimelineEvent: vi.fn<Apply>(async () => result) };
}

function makeRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubEnv("OPS_ROUTINE_CALLBACK_TOKEN", TOKEN);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/internal/run-timeline — auth", () => {
  it("returns 401 without an Authorization header", async () => {
    const deps = makeDeps();
    const request = new Request(URL, { method: "POST", body: JSON.stringify(BODY) });
    const response = await createRunTimelineHandler(deps)(request);
    expect(response.status).toBe(401);
    expect(deps.applyRoutineTimelineEvent).not.toHaveBeenCalled();
  });

  it("returns 401 with the wrong token", async () => {
    const deps = makeDeps();
    const response = await createRunTimelineHandler(deps)(
      makeRequest(BODY, { authorization: "Bearer nope" }),
    );
    expect(response.status).toBe(401);
  });

  it("returns 401 for every request when the token env is unset", async () => {
    vi.stubEnv("OPS_ROUTINE_CALLBACK_TOKEN", "");
    const deps = makeDeps();
    const response = await createRunTimelineHandler(deps)(
      makeRequest(BODY, { authorization: "Bearer " }),
    );
    expect(response.status).toBe(401);
    expect(deps.applyRoutineTimelineEvent).not.toHaveBeenCalled();
  });
});

describe("POST /api/internal/run-timeline — body", () => {
  it("returns 400 on invalid JSON", async () => {
    const deps = makeDeps();
    const response = await createRunTimelineHandler(deps)(makeRequest("{not json"));
    expect(response.status).toBe(400);
    expect(deps.applyRoutineTimelineEvent).not.toHaveBeenCalled();
  });

  it("returns 400 when the service rejects the body", async () => {
    const deps = makeDeps({ ok: false, error: "event.kind: invalid" });
    const response = await createRunTimelineHandler(deps)(makeRequest(BODY));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "event.kind: invalid" });
  });
});

describe("POST /api/internal/run-timeline — service call", () => {
  it("passes the parsed body to the service and returns its result", async () => {
    const deps = makeDeps({ ok: true, appended: true, recorded: 2 });
    const response = await createRunTimelineHandler(deps)(makeRequest(BODY));
    expect(deps.applyRoutineTimelineEvent).toHaveBeenCalledWith(BODY);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, appended: true, recorded: 2 });
  });

  it("returns 502 when the timeline append failed", async () => {
    const deps = makeDeps({ ok: true, appended: false, recorded: 1 });
    const response = await createRunTimelineHandler(deps)(makeRequest(BODY));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ ok: true, appended: false, recorded: 1 });
  });
});
