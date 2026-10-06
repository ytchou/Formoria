import { afterEach, expect, it, vi } from "vitest";
import { startEditorialProducer } from "./editorial-producer";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it("retries a cold worker with the same operator-bound start identity and reports its actual usage", async () => {
  vi.stubEnv("EDITORIAL_PRODUCER_URL", "https://editorial.formoria.example/");
  vi.stubEnv("EDITORIAL_PRODUCER_TOKEN", "fixture-internal-token");
  vi.spyOn(console, "log").mockImplementation(() => {});
  const input = {
    requestId: "maria-christmas-start-card",
    operatorSlackId: "U_MARIA_GARCIA",
    channelId: "C_FORMORIA_EDITORIAL",
    threadTs: "1791043200.000100",
    brief: "Christmas gifts for small apartments",
  };
  const requests: unknown[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    expect(String(url)).toBe("https://editorial.formoria.example/runs/start");
    requests.push(JSON.parse(String(init?.body)));
    if (requests.length === 1)
      return new Response("Worker waking", { status: 503 });
    return Response.json({
      runId: "a".repeat(64),
      status: "awaiting_input",
      stage: "overlap",
      costUsd: 0.0173,
      costUncertain: true,
      question: {
        text: "Maintain the existing article or choose a distinct angle?",
      },
    });
  });
  const result = await startEditorialProducer(input);
  expect(requests).toEqual([input, input]);
  expect(result).toMatchObject({
    ok: true,
    status: "awaiting_input",
    costUsd: 0.0173,
    costUncertain: true,
  });
});

const coldStartInput = {
  requestId: "maria-christmas-start-card",
  operatorSlackId: "U_MARIA_GARCIA",
  channelId: "C_FORMORIA_EDITORIAL",
  threadTs: "1791043200.000100",
  brief: "Christmas gifts for small apartments",
};

it("keeps retrying refused connections while a sleeping worker boots", async () => {
  vi.useFakeTimers();
  vi.stubEnv("EDITORIAL_PRODUCER_URL", "https://editorial.formoria.example");
  vi.stubEnv("EDITORIAL_PRODUCER_TOKEN", "fixture-internal-token");
  vi.spyOn(console, "log").mockImplementation(() => {});
  // Production cold start: the container accepts nothing for ~5.6s.
  const listeningAt = Date.now() + 5_600;
  let calls = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    calls++;
    if (Date.now() < listeningAt) throw new TypeError("fetch failed");
    return Response.json({
      runId: "a".repeat(64),
      status: "running",
      stage: "research",
      costUsd: 0,
      costUncertain: false,
    });
  });
  try {
    const pending = startEditorialProducer(coldStartInput);
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ ok: true, status: "running" });
    expect(calls).toBeGreaterThan(1);
  } finally {
    vi.useRealTimers();
  }
});

it("gives up with a retry hint once the worker never comes up", async () => {
  vi.useFakeTimers();
  vi.stubEnv("EDITORIAL_PRODUCER_URL", "https://editorial.formoria.example");
  vi.stubEnv("EDITORIAL_PRODUCER_TOKEN", "fixture-internal-token");
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(globalThis, "fetch").mockRejectedValue(
    new TypeError("fetch failed"),
  );
  try {
    const pending = startEditorialProducer(coldStartInput);
    await vi.runAllTimersAsync();
    expect(await pending).toEqual({
      ok: false,
      error:
        "Editorial worker unavailable; retry the same request to avoid duplicate starts",
    });
  } finally {
    vi.useRealTimers();
  }
});

it("returns the active run status immediately when a new start is refused", async () => {
  vi.stubEnv("EDITORIAL_PRODUCER_URL", "https://editorial.formoria.example");
  vi.stubEnv("EDITORIAL_PRODUCER_TOKEN", "fixture-internal-token");
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json({ status: "awaiting_input" }, { status: 409 }),
  );
  expect(
    await startEditorialProducer({
      requestId: "maria-new-angle",
      operatorSlackId: "U_MARIA_GARCIA",
      channelId: "C_FORMORIA_EDITORIAL",
      threadTs: "1791043200.000100",
      brief: "Reading corner gifts",
    }),
  ).toMatchObject({
    ok: false,
    error: expect.stringContaining("awaiting_input"),
  });
});
