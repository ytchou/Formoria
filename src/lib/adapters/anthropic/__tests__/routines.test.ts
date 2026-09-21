import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/audit", () => ({
  auditedCall: vi.fn().mockImplementation(
    (_spec: unknown, fn: (ctx: { summary: Record<string, unknown> }) => unknown) =>
      fn({ summary: {} }),
  ),
}));

import { fireRoutine } from "../routines";

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("fireRoutine", () => {
  it("fires routine and returns session URL", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ session_url: "https://claude.ai/code/session/abc" }),
    );

    const result = await fireRoutine({
      routineId: "routine-123",
      text: "do something",
    });

    expect(result).toEqual({
      sessionUrl: "https://claude.ai/code/session/abc",
    });
    expect(fetchMock).toHaveBeenCalledOnce();

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      "https://api.anthropic.com/v1/claude_code/routines/routine-123/fire",
    );
    expect(init!.method).toBe("POST");
    expect((init!.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json",
    );
    expect((init!.headers as Record<string, string>).Authorization).toBe(
      "Bearer test-key",
    );
    const body = JSON.parse(init!.body as string);
    expect(body).toEqual({ text: "do something" });
  });

  it("throws on API error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Internal Server Error", { status: 500 }),
    );

    await expect(
      fireRoutine({ routineId: "routine-123", text: "do something" }),
    ).rejects.toThrow("Routines API error");
  });

  it("uses ANTHROPIC_API_KEY from env", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key-123");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ session_url: "https://claude.ai/code/session/x" }),
    );

    await fireRoutine({ routineId: "r1", text: "hi" });

    const [, init] = fetchMock.mock.calls[0]!;
    expect((init!.headers as Record<string, string>).Authorization).toBe(
      "Bearer test-key-123",
    );
  });

  it("sends text in request body", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ session_url: "https://claude.ai/code/session/x" }),
    );

    await fireRoutine({ routineId: "r1", text: '{"channel":"C1"}' });

    const [, init] = fetchMock.mock.calls[0]!;
    expect(init!.body).toBe(JSON.stringify({ text: '{"channel":"C1"}' }));
  });

  it("throws when ANTHROPIC_API_KEY is missing", async () => {
    vi.unstubAllEnvs();
    delete process.env.ANTHROPIC_API_KEY;

    await expect(
      fireRoutine({ routineId: "r1", text: "hi" }),
    ).rejects.toThrow("ANTHROPIC_API_KEY is not set");
  });
});
