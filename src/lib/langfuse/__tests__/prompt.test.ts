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
    const mod = await import("../prompt");
    return mod.fetchLangfusePrompt;
  }

  it("fetches_prompt_from_langfuse", async () => {
    const mockPromptClient = {
      prompt: "remote-text",
      compile: vi.fn(),
    };
    const mockClient = {
      getPrompt: vi.fn().mockResolvedValue(mockPromptClient),
    };
    mockGetLangfuse.mockReturnValue(mockClient);

    const fetchLangfusePrompt = await loadModule();
    const result = await fetchLangfusePrompt("my-prompt", "local-fallback");

    expect(result).toBe("remote-text");
    expect(mockClient.getPrompt).toHaveBeenCalledWith("my-prompt", undefined, {
      fallback: "local-fallback",
      label: "production",
    });
  });

  it("compiles_variables_when_provided", async () => {
    const mockPromptClient = {
      prompt: "Hello {{name}}, welcome to {{place}}",
      compile: vi.fn().mockReturnValue("Hello Alice, welcome to Wonderland"),
    };
    const mockClient = {
      getPrompt: vi.fn().mockResolvedValue(mockPromptClient),
    };
    mockGetLangfuse.mockReturnValue(mockClient);

    const fetchLangfusePrompt = await loadModule();
    const result = await fetchLangfusePrompt("greeting", "fallback", {
      name: "Alice",
      place: "Wonderland",
    });

    expect(result).toBe("Hello Alice, welcome to Wonderland");
    expect(mockPromptClient.compile).toHaveBeenCalledWith({
      name: "Alice",
      place: "Wonderland",
    });
  });

  it("asserts_missing_variables", async () => {
    const mockPromptClient = {
      prompt: "Hello {{name}}, welcome to {{place}}",
      compile: vi.fn(),
    };
    const mockClient = {
      getPrompt: vi.fn().mockResolvedValue(mockPromptClient),
    };
    mockGetLangfuse.mockReturnValue(mockClient);

    const fetchLangfusePrompt = await loadModule();

    await expect(
      fetchLangfusePrompt("greeting", "fallback", { name: "Alice" }),
    ).rejects.toThrow("place");
  });

  it("returns_fallback_when_no_client", async () => {
    mockGetLangfuse.mockReturnValue(null);

    const fetchLangfusePrompt = await loadModule();
    const result = await fetchLangfusePrompt("missing", "local-fallback");

    expect(result).toBe("local-fallback");
  });

  it("returns_fallback_on_sdk_error", async () => {
    const fallbackPromptClient = {
      prompt: "safe-fallback",
      compile: vi.fn(),
    };
    const mockClient = {
      // SDK's built-in fallback: when getPrompt is configured with a fallback
      // and the fetch fails, the SDK returns a TextPromptClient with the fallback text
      getPrompt: vi.fn().mockResolvedValue(fallbackPromptClient),
    };
    mockGetLangfuse.mockReturnValue(mockClient);

    const fetchLangfusePrompt = await loadModule();
    const result = await fetchLangfusePrompt("broken", "safe-fallback");

    expect(result).toBe("safe-fallback");
  });
});
