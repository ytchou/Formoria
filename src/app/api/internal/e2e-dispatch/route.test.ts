import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createE2eDispatchHandler, type E2eDispatchRouteDeps } from "./route";

const SECRET = "dispatch-secret";
const RUN_ID = "4f2a9d31-8b67-4c05-ae19-7d3f6b2c1a80";
const DISPATCH_ID = "9c1e2b44-0d3a-4f8e-b6a1-2e7c5d9f0a13";
const URL = "http://localhost/api/internal/e2e-dispatch";

function makeDeps(
  overrides: Partial<E2eDispatchRouteDeps> = {},
): E2eDispatchRouteDeps {
  return {
    claimDispatch: vi.fn().mockResolvedValue(null),
    completeDispatch: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

function makeRequest(
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request(URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${SECRET}`,
      "content-type": "application/json",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubEnv("E2E_DISPATCH_SECRET", SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/internal/e2e-dispatch — auth", () => {
  it("returns 401 without an Authorization header", async () => {
    const deps = makeDeps();
    const request = new Request(URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "claim", runId: RUN_ID }),
    });

    const response = await createE2eDispatchHandler(deps)(request);

    expect(response.status).toBe(401);
    expect(deps.claimDispatch).not.toHaveBeenCalled();
  });

  it("returns 401 for a wrong token", async () => {
    const deps = makeDeps();
    const response = await createE2eDispatchHandler(deps)(
      makeRequest(
        { action: "claim", runId: RUN_ID },
        { authorization: "Bearer wrong" },
      ),
    );

    expect(response.status).toBe(401);
    expect(deps.claimDispatch).not.toHaveBeenCalled();
  });

  it.each(["", "   "])(
    "returns 401 when E2E_DISPATCH_SECRET is blank (%j)",
    async (value) => {
      vi.stubEnv("E2E_DISPATCH_SECRET", value);
      const deps = makeDeps();
      const response = await createE2eDispatchHandler(deps)(
        makeRequest(
          { action: "claim", runId: RUN_ID },
          { authorization: `Bearer ${value}` },
        ),
      );

      expect(response.status).toBe(401);
      expect(deps.claimDispatch).not.toHaveBeenCalled();
    },
  );
});

describe("POST /api/internal/e2e-dispatch — body validation", () => {
  it("returns 415 for a non-JSON content type", async () => {
    const response = await createE2eDispatchHandler(makeDeps())(
      makeRequest(
        { action: "claim", runId: RUN_ID },
        { "content-type": "text/plain" },
      ),
    );
    expect(response.status).toBe(415);
  });

  it("returns 413 for a body over 4096 bytes", async () => {
    const response = await createE2eDispatchHandler(makeDeps())(
      makeRequest({ action: "claim", runId: RUN_ID, pad: "x".repeat(5_000) }),
    );
    expect(response.status).toBe(413);
  });

  it("returns 400 for invalid JSON", async () => {
    const response = await createE2eDispatchHandler(makeDeps())(
      makeRequest("{not json"),
    );
    expect(response.status).toBe(400);
  });

  it("returns 400 for an unknown action", async () => {
    const deps = makeDeps();
    const response = await createE2eDispatchHandler(deps)(
      makeRequest({ action: "release", runId: RUN_ID }),
    );
    expect(response.status).toBe(400);
    expect(deps.claimDispatch).not.toHaveBeenCalled();
    expect(deps.completeDispatch).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-uuid runId", async () => {
    const deps = makeDeps();
    const response = await createE2eDispatchHandler(deps)(
      makeRequest({ action: "claim", runId: "run-1" }),
    );
    expect(response.status).toBe(400);
    expect(deps.claimDispatch).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-uuid dispatchId on complete", async () => {
    const deps = makeDeps();
    const response = await createE2eDispatchHandler(deps)(
      makeRequest({
        action: "complete",
        dispatchId: "req-1",
        runId: RUN_ID,
        outcome: "green",
      }),
    );
    expect(response.status).toBe(400);
    expect(deps.completeDispatch).not.toHaveBeenCalled();
  });

  it("returns 400 for an unknown outcome on complete", async () => {
    const deps = makeDeps();
    const response = await createE2eDispatchHandler(deps)(
      makeRequest({
        action: "complete",
        dispatchId: DISPATCH_ID,
        runId: RUN_ID,
        outcome: "passed",
      }),
    );
    expect(response.status).toBe(400);
    expect(deps.completeDispatch).not.toHaveBeenCalled();
  });
});

describe("POST /api/internal/e2e-dispatch — claim", () => {
  it("returns {dispatch:null} when nothing is pending", async () => {
    const deps = makeDeps();
    const response = await createE2eDispatchHandler(deps)(
      makeRequest({ action: "claim", runId: RUN_ID }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ dispatch: null });
    expect(deps.claimDispatch).toHaveBeenCalledWith(RUN_ID);
  });

  it("returns only the public projection of a claimed dispatch", async () => {
    const deps = makeDeps({
      claimDispatch: vi.fn().mockResolvedValue({
        id: DISPATCH_ID,
        channelId: "C_OPS",
        threadTs: "1234.5678",
        requesterId: "U_OP1",
        runId: RUN_ID,
        claimedAt: "2026-09-24T00:00:00Z",
      }),
    });
    const response = await createE2eDispatchHandler(deps)(
      makeRequest({ action: "claim", runId: RUN_ID }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      dispatch: {
        id: DISPATCH_ID,
        channelId: "C_OPS",
        threadTs: "1234.5678",
        requesterId: "U_OP1",
      },
    });
  });
});

describe("POST /api/internal/e2e-dispatch — complete", () => {
  it("forwards (dispatchId, runId, outcome) to completeDispatch", async () => {
    const deps = makeDeps();
    const response = await createE2eDispatchHandler(deps)(
      makeRequest({
        action: "complete",
        dispatchId: DISPATCH_ID,
        runId: RUN_ID,
        outcome: "errored",
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, updated: true });
    expect(deps.completeDispatch).toHaveBeenCalledWith(
      DISPATCH_ID,
      RUN_ID,
      "errored",
    );
  });

  it("reports updated:false when no row matched", async () => {
    const deps = makeDeps({
      completeDispatch: vi.fn().mockResolvedValue(false),
    });
    const response = await createE2eDispatchHandler(deps)(
      makeRequest({
        action: "complete",
        dispatchId: DISPATCH_ID,
        runId: RUN_ID,
        outcome: "red",
      }),
    );

    expect(await response.json()).toEqual({ ok: true, updated: false });
  });
});
