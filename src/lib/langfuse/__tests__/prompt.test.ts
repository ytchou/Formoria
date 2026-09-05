import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function loadModule() {
    return import("../prompt");
  }

  it("fetches_prompt_from_langfuse", async () => {
    const mockPromptClient = {
      prompt: "remote-text",
      compile: vi.fn(),
      name: "my-prompt",
      version: 3,
      isFallback: false,
    };
    const mockClient = {
      getPrompt: vi.fn().mockResolvedValue(mockPromptClient),
    };
    mockGetLangfuse.mockReturnValue(mockClient);

    const { fetchLangfusePrompt } = await loadModule();
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
      name: "greeting",
      version: 1,
      isFallback: false,
    };
    const mockClient = {
      getPrompt: vi.fn().mockResolvedValue(mockPromptClient),
    };
    mockGetLangfuse.mockReturnValue(mockClient);

    const { fetchLangfusePrompt } = await loadModule();
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
      name: "greeting",
      version: 1,
      isFallback: false,
    };
    const mockClient = {
      getPrompt: vi.fn().mockResolvedValue(mockPromptClient),
    };
    mockGetLangfuse.mockReturnValue(mockClient);

    const { fetchLangfusePrompt } = await loadModule();

    await expect(
      fetchLangfusePrompt("greeting", "fallback", { name: "Alice" }),
    ).rejects.toThrow("place");
  });

  it("returns_fallback_when_no_client", async () => {
    mockGetLangfuse.mockReturnValue(null);

    const { fetchLangfusePrompt } = await loadModule();
    const result = await fetchLangfusePrompt("missing", "local-fallback");

    expect(result).toBe("local-fallback");
  });

  it("returns_fallback_on_sdk_error", async () => {
    const fallbackPromptClient = {
      prompt: "safe-fallback",
      compile: vi.fn(),
      name: "broken",
      version: 0,
      isFallback: true,
    };
    const mockClient = {
      // SDK's built-in fallback: when getPrompt is configured with a fallback
      // and the fetch fails, the SDK returns a TextPromptClient with the fallback text
      getPrompt: vi.fn().mockResolvedValue(fallbackPromptClient),
    };
    mockGetLangfuse.mockReturnValue(mockClient);

    const { fetchLangfusePrompt } = await loadModule();
    const result = await fetchLangfusePrompt("broken", "safe-fallback");

    expect(result).toBe("safe-fallback");
  });

  // --- parsePromptVersionPins ---

  describe("parsePromptVersionPins", () => {
    it("parses LANGFUSE_PROMPT_VERSIONS into a name to version map", async () => {
      const { parsePromptVersionPins } = await loadModule();

      const env = { LANGFUSE_PROMPT_VERSIONS: "detect:2,descriptions:7" };
      expect(parsePromptVersionPins(env)).toEqual({
        detect: 2,
        descriptions: 7,
      });
    });

    it("returns empty object when env var is blank or unset", async () => {
      const { parsePromptVersionPins } = await loadModule();

      expect(parsePromptVersionPins({})).toEqual({});
      expect(parsePromptVersionPins({ LANGFUSE_PROMPT_VERSIONS: "" })).toEqual(
        {},
      );
    });

    it("throws naming the malformed pair", async () => {
      const { parsePromptVersionPins } = await loadModule();

      expect(() =>
        parsePromptVersionPins({
          LANGFUSE_PROMPT_VERSIONS: "detect:2,bad:abc",
        }),
      ).toThrow("bad:abc");
    });
  });

  // --- pinned prompt version ---

  it("pinned name calls getPrompt(name, version, {fallback}) with no label", async () => {
    const mockPromptClient = {
      prompt: "pinned-text",
      compile: vi.fn(),
      name: "detect",
      version: 2,
      isFallback: false,
    };
    const mockClient = {
      getPrompt: vi.fn().mockResolvedValue(mockPromptClient),
    };
    mockGetLangfuse.mockReturnValue(mockClient);

    vi.stubEnv("LANGFUSE_PROMPT_VERSIONS", "detect:2,descriptions:7");

    const { fetchLangfusePrompt } = await loadModule();
    await fetchLangfusePrompt("detect", "local-fallback");

    expect(mockClient.getPrompt).toHaveBeenCalledWith("detect", 2, {
      fallback: "local-fallback",
    });
  });

  it("unpinned name still requests label production", async () => {
    const mockPromptClient = {
      prompt: "unpinned-text",
      compile: vi.fn(),
      name: "other",
      version: 5,
      isFallback: false,
    };
    const mockClient = {
      getPrompt: vi.fn().mockResolvedValue(mockPromptClient),
    };
    mockGetLangfuse.mockReturnValue(mockClient);

    vi.stubEnv("LANGFUSE_PROMPT_VERSIONS", "detect:2");

    const { fetchLangfusePrompt } = await loadModule();
    await fetchLangfusePrompt("other", "local-fallback");

    expect(mockClient.getPrompt).toHaveBeenCalledWith("other", undefined, {
      fallback: "local-fallback",
      label: "production",
    });
  });

  // --- fetchLangfusePromptWithMeta ---

  it("fetchLangfusePromptWithMeta returns {text, prompt:{name,version}}", async () => {
    const mockPromptClient = {
      prompt: "remote-text",
      compile: vi.fn(),
      name: "detect",
      version: 3,
      isFallback: false,
    };
    const mockClient = {
      getPrompt: vi.fn().mockResolvedValue(mockPromptClient),
    };
    mockGetLangfuse.mockReturnValue(mockClient);

    const { fetchLangfusePromptWithMeta } = await loadModule();
    const result = await fetchLangfusePromptWithMeta(
      "detect",
      "local-fallback",
    );

    expect(result).toEqual({
      text: "remote-text",
      prompt: { name: "detect", version: 3 },
    });
  });

  it("fetchLangfusePromptWithMeta returns prompt null on fallback (no client)", async () => {
    mockGetLangfuse.mockReturnValue(null);

    const { fetchLangfusePromptWithMeta } = await loadModule();
    const result = await fetchLangfusePromptWithMeta(
      "missing",
      "local-fallback",
    );

    expect(result).toEqual({
      text: "local-fallback",
      prompt: null,
    });
  });

  it("fetchLangfusePromptWithMeta returns prompt null when fetch throws", async () => {
    const mockClient = {
      getPrompt: vi.fn().mockRejectedValue(new Error("network error")),
    };
    mockGetLangfuse.mockReturnValue(mockClient);

    const { fetchLangfusePromptWithMeta } = await loadModule();
    const result = await fetchLangfusePromptWithMeta(
      "broken",
      "local-fallback",
    );

    expect(result).toEqual({
      text: "local-fallback",
      prompt: null,
    });
  });

  it("fetchLangfusePrompt still returns a string", async () => {
    const mockPromptClient = {
      prompt: "remote-text",
      compile: vi.fn(),
      name: "detect",
      version: 3,
      isFallback: false,
    };
    const mockClient = {
      getPrompt: vi.fn().mockResolvedValue(mockPromptClient),
    };
    mockGetLangfuse.mockReturnValue(mockClient);

    const { fetchLangfusePrompt } = await loadModule();
    const result = await fetchLangfusePrompt("detect", "local-fallback");

    expect(typeof result).toBe("string");
    expect(result).toBe("remote-text");
  });
});
