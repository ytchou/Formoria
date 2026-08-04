import { afterEach, describe, expect, it, vi } from "vitest";
import { parseCliArgs } from "../curate-brands";

describe("parseCliArgs", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses enrich command with phases", () => {
    const args = parseCliArgs([
      "enrich",
      "--phases=discover,links,descriptions,locations",
    ]);
    expect(args.command).toBe("enrich");
    expect(args.config.phases).toEqual([
      "discover",
      "links",
      "descriptions",
      "locations",
    ]);
  });

  it("defaults enrich phases to all when not specified", () => {
    const args = parseCliArgs(["enrich"]);
    expect(args.command).toBe("enrich");
    expect(args.config.phases).toEqual([
      "clean",
      "detect",
      "slugs",
      "tags",
      "discover",
      "links",
      "names",
      "images",
      "classify_images",
      "descriptions",
      "locations",
      "reputation",
    ]);
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
