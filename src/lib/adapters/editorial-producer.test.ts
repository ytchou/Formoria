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
