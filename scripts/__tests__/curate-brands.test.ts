import { afterEach, describe, expect, it, vi } from "vitest";
import { parseCliArgs } from "../curate-brands";

describe("parseCliArgs", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses enrich command with phases", () => {
    const args = parseCliArgs([
      "enrich",
      "--phases=discover,links,descriptions,stockists",
    ]);
    expect(args.command).toBe("enrich");
    expect(args.config.phases).toEqual([
      "discover",
      "links",
      "descriptions",
      "stockists",
    ]);
  });

  it("defaults enrich phases to all when not specified", () => {
    const args = parseCliArgs(["enrich"]);
    expect(args.command).toBe("enrich");
    expect(args.config.phases!.length).toBeGreaterThan(0);
    // Core phases that the pipeline requires
    expect(args.config.phases).toContain("discover");
    expect(args.config.phases).toContain("descriptions");
  });

  it("rejects old deprecated commands", () => {
    expect(() => parseCliArgs(["set-visibility"])).toThrow(/unknown command/i);
    expect(() => parseCliArgs(["clean-names"])).toThrow(/unknown command/i);
    expect(() => parseCliArgs(["normalize-slugs"])).toThrow(/unknown command/i);
    expect(() => parseCliArgs(["detect-non-brands"])).toThrow(
      /unknown command/i,
    );
    expect(() => parseCliArgs(["enrich-descriptions"])).toThrow(
      /unknown command/i,
    );
  });
});
