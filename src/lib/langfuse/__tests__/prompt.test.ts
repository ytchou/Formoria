import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import snapshot from "@/lib/prompts/langfuse-snapshot.json";

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

  it("snapshotPrompt_joins_lines_and_returns_version", async () => {
    const { snapshotPrompt } = await loadModule();
    const result = snapshotPrompt("detect");

    expect(result.text).toBe(snapshot.prompts.detect.text.join("\n"));
    expect(result.version).toBe(snapshot.prompts.detect.version);

    // Unknown name throws naming it
    expect(() => snapshotPrompt("nonexistent" as never)).toThrow("nonexistent");
  });

  it("no_client_returns_snapshot_source_with_compiled_variables", async () => {
    mockGetLangfuse.mockReturnValue(null);

    const { fetchLangfusePromptWithMeta } = await loadModule();
    const result = await fetchLangfusePromptWithMeta("faq-preamble", {
      taiwan_usage_rules: "TEST_RULES",
    });

    expect(result.prompt).toEqual({
      name: "faq-preamble",
      version: snapshot.prompts["faq-preamble"].version,
      source: "snapshot",
    });
    expect(result.text).toContain("TEST_RULES");
    expect(result.text).not.toContain("{{taiwan_usage_rules}}");
  });

  it("sdk_fallback_returns_snapshot_source", async () => {
    const snap = snapshot.prompts.detect;
    const snapshotText = snap.text.join("\n");

    const mockPromptClient = {
      prompt: snapshotText,
      compile: vi.fn(),
      name: "detect",
      version: 0,
      isFallback: true,
    };
    const mockClient = {
      getPrompt: vi.fn().mockResolvedValue(mockPromptClient),
    };
    mockGetLangfuse.mockReturnValue(mockClient);

    const { fetchLangfusePromptWithMeta } = await loadModule();
    const result = await fetchLangfusePromptWithMeta("detect");

    expect(result.prompt).toEqual({
      name: "detect",
      version: snap.version,
      source: "snapshot",
    });
  });

  it("langfuse_hit_returns_langfuse_source_and_version", async () => {
    const snap = snapshot.prompts.detect;
    const snapshotText = snap.text.join("\n");

    const mockPromptClient = {
      prompt: snapshotText,
      compile: vi.fn(),
      name: "detect",
      version: 9,
      isFallback: false,
    };
    const mockClient = {
      getPrompt: vi.fn().mockResolvedValue(mockPromptClient),
    };
    mockGetLangfuse.mockReturnValue(mockClient);

    const warnSpy = vi.spyOn(console, "warn");

    const { fetchLangfusePromptWithMeta } = await loadModule();
    const result = await fetchLangfusePromptWithMeta("detect");

    expect(result.prompt).toEqual({
      name: "detect",
      version: 9,
      source: "langfuse",
    });
    // No drift warning because text matches snapshot
    const driftWarnings = warnSpy.mock.calls.filter(
      (args) =>
        typeof args[0] === "string" && args[0].includes("[langfuse] prompt"),
    );
    expect(driftWarnings).toHaveLength(0);

    warnSpy.mockRestore();
  });

  it("drift_warns_once_per_name", async () => {
    const mockPromptClient = {
      prompt: "different-remote-text",
      compile: vi.fn(),
      name: "detect",
      version: 9,
      isFallback: false,
    };
    const mockClient = {
      getPrompt: vi.fn().mockResolvedValue(mockPromptClient),
    };
    mockGetLangfuse.mockReturnValue(mockClient);

    const warnSpy = vi.spyOn(console, "warn");

    const { fetchLangfusePromptWithMeta } = await loadModule();

    // First fetch — warns
    await fetchLangfusePromptWithMeta("detect");
    let driftWarnings = warnSpy.mock.calls.filter(
      (args) =>
        typeof args[0] === "string" && args[0].includes("[langfuse] prompt"),
    );
    expect(driftWarnings).toHaveLength(1);
    expect(driftWarnings[0]![0]).toContain("v9");
    expect(driftWarnings[0]![0]).toContain(
      `v${snapshot.prompts.detect.version}`,
    );
    expect(driftWarnings[0]![0]).toContain("prompt pull");

    // Second fetch of same name — no new warning
    await fetchLangfusePromptWithMeta("detect");
    driftWarnings = warnSpy.mock.calls.filter(
      (args) =>
        typeof args[0] === "string" && args[0].includes("[langfuse] prompt"),
    );
    expect(driftWarnings).toHaveLength(1);

    // Different name — warns again
    const mockPromptClient2 = {
      prompt: "another-different-text",
      compile: vi.fn(),
      name: "category-classify",
      version: 5,
      isFallback: false,
    };
    mockClient.getPrompt.mockResolvedValue(mockPromptClient2);
    await fetchLangfusePromptWithMeta("category-classify");
    driftWarnings = warnSpy.mock.calls.filter(
      (args) =>
        typeof args[0] === "string" && args[0].includes("[langfuse] prompt"),
    );
    expect(driftWarnings).toHaveLength(2);

    warnSpy.mockRestore();
  });

  it("pinned_version_routes_without_label", async () => {
    const snap = snapshot.prompts.detect;
    const snapshotText = snap.text.join("\n");

    const mockPromptClient = {
      prompt: "pinned-text",
      compile: vi.fn(),
      name: "detect",
      version: 3,
      isFallback: false,
    };
    const mockClient = {
      getPrompt: vi.fn().mockResolvedValue(mockPromptClient),
    };
    mockGetLangfuse.mockReturnValue(mockClient);

    vi.stubEnv("LANGFUSE_PROMPT_VERSIONS", "detect:3");

    const { fetchLangfusePrompt } = await loadModule();
    await fetchLangfusePrompt("detect");

    expect(mockClient.getPrompt).toHaveBeenCalledWith("detect", 3, {
      fallback: snapshotText,
    });
  });

  it("missing_variable_still_throws_outside_try_catch", async () => {
    mockGetLangfuse.mockReturnValue(null);

    const { fetchLangfusePrompt } = await loadModule();

    await expect(
      fetchLangfusePrompt("faq-preamble", {}),
    ).rejects.toThrow("taiwan_usage_rules");
  });

  it("fetchLangfusePrompt_returns_text_only", async () => {
    mockGetLangfuse.mockReturnValue(null);

    const { fetchLangfusePrompt } = await loadModule();
    const result = await fetchLangfusePrompt("detect");

    expect(typeof result).toBe("string");
    expect(result).toBe(snapshot.prompts.detect.text.join("\n"));
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
});
