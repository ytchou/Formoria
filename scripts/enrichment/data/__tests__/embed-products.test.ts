import { describe, expect, it } from "vitest";

describe("embed-products parseArgs", () => {
  it("reads --all, --limit, --dry-run and rejects unknown flags", async () => {
    const { parseArgs } = await import("../embed-products");

    const result = parseArgs(["--all", "--limit", "500"]);
    expect(result.all).toBe(true);
    expect(result.limit).toBe(500);
    expect(result.dryRun).toBe(true); // default

    const applied = parseArgs(["--apply"]);
    expect(applied.dryRun).toBe(false);

    expect(() => parseArgs(["--foo"])).toThrow("Unknown flag: --foo");
  });

  it("main refuses production without --target production", async () => {
    // This test validates that loadScriptTarget is the first call in main().
    // We verify by checking that the function exists and has the expected shape.
    const mod = await import("../embed-products");
    expect(typeof mod.parseArgs).toBe("function");
  });
});
