import { afterEach, describe, expect, it, vi } from "vitest";
import { parseCliArgs } from "../curate-brands";
import {
  DEFERRED_PHASES,
  phasesForTask,
} from "@/lib/constants/enrich-phases";

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
    // `discover` is deferred and dropped; `links` is the retired name of
    // `acquire`; the result is in ENRICH_PHASES order, not flag order.
    expect(args.config.phases).toEqual([
      "acquire",
      "descriptions",
      "stockists",
    ]);
  });

  it("defaults enrich phases to the full closure when not specified", () => {
    const args = parseCliArgs(["enrich"]);
    expect(args.command).toBe("enrich");
    expect(args.config.phases).toEqual(phasesForTask("full"));
    // Core phases that the pipeline requires
    expect(args.config.phases).toContain("acquire");
    expect(args.config.phases).toContain("descriptions");
    // Deferred phases have no runner, so the default never names one.
    for (const phase of DEFERRED_PHASES) {
      expect(args.config.phases).not.toContain(phase);
    }
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
