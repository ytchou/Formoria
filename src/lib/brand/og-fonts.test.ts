// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";

describe("getOgFonts", () => {
  beforeEach(() => vi.resetModules());

  it("returns both font faces with names and data", async () => {
    const { getOgFonts } = await import("./og-fonts");
    const fonts = await getOgFonts();
    const names = fonts.map((f) => f.name);
    expect(names).toContain("Bricolage Grotesque");
    expect(names).toContain("Noto Sans TC");
    fonts.forEach((f) => expect(f.data.byteLength).toBeGreaterThan(0));
  });

  it("returns [] when a font file cannot be read (no 500 upstream)", async () => {
    vi.doMock("node:fs/promises", () => ({
      readFile: vi.fn().mockRejectedValue(new Error("ENOENT")),
    }));
    const { getOgFonts } = await import("./og-fonts");
    const fonts = await getOgFonts();
    expect(fonts).toEqual([]);
    vi.doUnmock("node:fs/promises");
  });
});

describe("NotoSansTC font file", () => {
  it("has TrueType glyf outlines (not CFF) for @vercel/og compatibility", async () => {
    const fontPath = path.resolve(
      process.cwd(),
      "src/assets/fonts/NotoSansTC-subset.ttf",
    );
    const buf = await readFile(fontPath);
    // TrueType fonts: offset table starts with 0x00010000 or 0x74727565 ('true')
    // CFF/OTF fonts: offset table starts with 0x4F54544F ('OTTO')
    const magic = buf.readUInt32BE(0);
    const isCFF = magic === 0x4f54544f; // 'OTTO'
    expect(isCFF).toBe(false);
  });
});
