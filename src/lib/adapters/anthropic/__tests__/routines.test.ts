import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/audit", () => ({
  auditedCall: vi.fn().mockImplementation(
    (_spec: unknown, fn: (ctx: { summary: Record<string, unknown> }) => unknown) =>
      fn({ summary: {} }),
  ),
}));

import { fireRoutine } from "../routines";

beforeEach(() => {
  vi.stubEnv("OPS_ROUTINE_TOKEN", "test-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("fireRoutine", () => {
  it("fires routine and returns session URL", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ claude_code_session_url: "https://claude.ai/code/session/abc" }),
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
    const headers = init!.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers.Authorization).toBe("Bearer test-key");
    expect(headers["anthropic-beta"]).toBe("experimental-cc-routine-2026-04-01");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
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

  it("uses OPS_ROUTINE_TOKEN from env", async () => {
    vi.stubEnv("OPS_ROUTINE_TOKEN", "test-key-123");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ claude_code_session_url: "https://claude.ai/code/session/x" }),
    );

    await fireRoutine({ routineId: "r1", text: "hi" });

    const [, init] = fetchMock.mock.calls[0]!;
    expect((init!.headers as Record<string, string>).Authorization).toBe(
      "Bearer test-key-123",
    );
  });

  it("sends text in request body", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ claude_code_session_url: "https://claude.ai/code/session/x" }),
    );

    await fireRoutine({ routineId: "r1", text: '{"channel":"C1"}' });

    const [, init] = fetchMock.mock.calls[0]!;
    expect(init!.body).toBe(JSON.stringify({ text: '{"channel":"C1"}' }));
  });

  it("throws when OPS_ROUTINE_TOKEN is missing", async () => {
    vi.unstubAllEnvs();
    delete process.env.OPS_ROUTINE_TOKEN;

    await expect(
      fireRoutine({ routineId: "r1", text: "hi" }),
    ).rejects.toThrow("OPS_ROUTINE_TOKEN is not set");
  });
});
