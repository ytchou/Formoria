import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetAuditEmitterForTests,
  setAuditWriteSeam,
  type AuditRecord,
} from "@/lib/audit";
import { claimDispatch, completeDispatch } from "../client";

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const DISPATCH_ID = "22222222-2222-4222-8222-222222222222";
const ENDPOINT = "https://formoria-production.up.railway.app/api/internal/e2e-dispatch";

let writes: AuditRecord[] = [];

function bodyOf(init: RequestInit | undefined) {
  return JSON.parse(init!.body as string) as Record<string, unknown>;
}

beforeEach(() => {
  writes = [];
  setAuditWriteSeam(async (record) => {
    writes.push(record);
    return null;
  });
  vi.stubEnv("E2E_DISPATCH_URL", "https://formoria-production.up.railway.app/");
  vi.stubEnv("E2E_DISPATCH_SECRET", "dispatch-secret");
});

afterEach(() => {
  resetAuditEmitterForTests();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("claimDispatch", () => {
  it("returns unconfigured without fetching when E2E_DISPATCH_URL is unset", async () => {
    vi.stubEnv("E2E_DISPATCH_URL", "");
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await expect(claimDispatch(RUN_ID)).resolves.toEqual({
      dispatch: null,
      reason: "unconfigured",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns unconfigured without fetching when E2E_DISPATCH_SECRET is unset", async () => {
    vi.stubEnv("E2E_DISPATCH_SECRET", "  ");
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await expect(claimDispatch(RUN_ID)).resolves.toEqual({
      dispatch: null,
      reason: "unconfigured",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts a bearer-authenticated claim and returns the dispatch", async () => {
    const dispatch = {
      id: DISPATCH_ID,
      channelId: "C0OPS",
      threadTs: "1700000000.000200",
      requesterId: "U0REQ",
    };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ dispatch }));

    await expect(claimDispatch(RUN_ID)).resolves.toEqual({ dispatch });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(ENDPOINT);
    expect(init!.method).toBe("POST");
    expect(init!.headers).toEqual(
      expect.objectContaining({
        Authorization: "Bearer dispatch-secret",
        "Content-Type": "application/json",
      }),
    );
    expect(init!.signal).toBeInstanceOf(AbortSignal);
    expect(bodyOf(init)).toEqual({ action: "claim", runId: RUN_ID });
    expect(writes.filter((w) => w.status !== "started")).toEqual([
      expect.objectContaining({
        provider: "ops-dispatch",
        operation: "claim_dispatch",
        status: "succeeded",
      }),
    ]);
  });

  it("returns dispatch null when nothing is pending", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json({ dispatch: null }),
    );

    await expect(claimDispatch(RUN_ID)).resolves.toEqual({ dispatch: null });
  });

  it("prefixes https:// onto a bare host", async () => {
    vi.stubEnv("E2E_DISPATCH_URL", "formoria-production.up.railway.app");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ dispatch: null }));

    await claimDispatch(RUN_ID);

    expect(fetchMock.mock.calls[0]![0]).toBe(ENDPOINT);
  });

  it.each([404, 500, 503])("maps HTTP %i to reason http-<status>", async (status) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("nope", { status }),
    );

    await expect(claimDispatch(RUN_ID)).resolves.toEqual({
      dispatch: null,
      reason: `http-${status}`,
    });
  });

  it("maps 401 to http-401 and logs claim=unauthorized", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Unauthorized", { status: 401 }),
    );

    await expect(claimDispatch(RUN_ID)).resolves.toEqual({
      dispatch: null,
      reason: "http-401",
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("claim=unauthorized"),
    );
  });

  it("maps a timeout to reason timeout and never throws", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
      new DOMException("The operation was aborted due to timeout", "TimeoutError"),
    );

    await expect(claimDispatch(RUN_ID)).resolves.toEqual({
      dispatch: null,
      reason: "timeout",
    });
  });

  it("scrubs secrets out of network error reasons", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
      new Error("connect failed Bearer dispatch-secret token=abc"),
    );

    const result = await claimDispatch(RUN_ID);

    expect(result.dispatch).toBeNull();
    expect(result.reason).not.toContain("dispatch-secret");
    expect(result.reason).not.toContain("abc");
  });

  it("treats a malformed dispatch body as no dispatch", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json({ dispatch: { id: DISPATCH_ID } }),
    );

    await expect(claimDispatch(RUN_ID)).resolves.toEqual({
      dispatch: null,
      reason: "invalid-response",
    });
  });
});

describe("completeDispatch", () => {
  it("returns unconfigured without fetching when env is missing", async () => {
    vi.stubEnv("E2E_DISPATCH_URL", "");
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await expect(
      completeDispatch({ dispatchId: DISPATCH_ID, runId: RUN_ID, outcome: "green" }),
    ).resolves.toEqual({ ok: false, reason: "unconfigured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the completion and returns updated", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ ok: true, updated: true }));

    await expect(
      completeDispatch({ dispatchId: DISPATCH_ID, runId: RUN_ID, outcome: "red" }),
    ).resolves.toEqual({ ok: true, updated: true });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(ENDPOINT);
    expect(bodyOf(init)).toEqual({
      action: "complete",
      dispatchId: DISPATCH_ID,
      runId: RUN_ID,
      outcome: "red",
    });
  });

  it("maps HTTP failures and timeouts without throwing", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("down", { status: 502 }))
      .mockRejectedValueOnce(
        new DOMException("The operation was aborted due to timeout", "TimeoutError"),
      );

    await expect(
      completeDispatch({ dispatchId: DISPATCH_ID, runId: RUN_ID, outcome: "errored" }),
    ).resolves.toEqual({ ok: false, reason: "http-502" });
    await expect(
      completeDispatch({ dispatchId: DISPATCH_ID, runId: RUN_ID, outcome: "crashed" }),
    ).resolves.toEqual({ ok: false, reason: "timeout" });
  });

  it("treats a malformed completion body as not updated", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json({ ok: true, updated: "yes" }),
    );

    await expect(
      completeDispatch({ dispatchId: DISPATCH_ID, runId: RUN_ID, outcome: "green" }),
    ).resolves.toEqual({ ok: true, updated: false });
  });
});
