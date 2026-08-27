import { describe, it, expect, vi, beforeEach } from "vitest";

// Stable mock reference that persists across resetModules
const mockGetLangfuse = vi.fn();

vi.mock("../client", () => ({
  getLangfuse: mockGetLangfuse,
}));

describe("langfuse/prompt", () => {
  beforeEach(() => {
    vi.resetModules();
    mockGetLangfuse.mockReset();
  });

  async function loadModule() {
    // Dynamic import so each test gets a fresh module-level cache
    const mod = await import("../prompt");
    return mod.fetchLangfusePrompt;
  }

  it("returns_langfuse_prompt_when_available", async () => {
    const mockClient = {
      getPrompt: vi.fn().mockResolvedValue({ prompt: "remote-text" }),
    };
    mockGetLangfuse.mockReturnValue(mockClient);

    const fetchLangfusePrompt = await loadModule();
    const result = await fetchLangfusePrompt("my-prompt", "local-fallback");

    expect(result).toBe("remote-text");
    expect(mockClient.getPrompt).toHaveBeenCalledWith("my-prompt");
  });

  it("falls_back_to_local_constant_when_langfuse_unavailable", async () => {
    mockGetLangfuse.mockReturnValue(null);

    const fetchLangfusePrompt = await loadModule();
    const result = await fetchLangfusePrompt("missing", "local-fallback");

    expect(result).toBe("local-fallback");
  });

  it("falls_back_on_getPrompt_error", async () => {
    const mockClient = {
      getPrompt: vi.fn().mockRejectedValue(new Error("network error")),
    };
    mockGetLangfuse.mockReturnValue(mockClient);

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchLangfusePrompt = await loadModule();
    const result = await fetchLangfusePrompt("broken", "safe-fallback");

    expect(result).toBe("safe-fallback");
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("caches_prompt_within_same_name", async () => {
    const mockClient = {
      getPrompt: vi.fn().mockResolvedValue({ prompt: "cached-text" }),
    };
    mockGetLangfuse.mockReturnValue(mockClient);

    const fetchLangfusePrompt = await loadModule();
    await fetchLangfusePrompt("same-name", "fallback");
    await fetchLangfusePrompt("same-name", "fallback");

    expect(mockClient.getPrompt).toHaveBeenCalledTimes(1);
  });
});
