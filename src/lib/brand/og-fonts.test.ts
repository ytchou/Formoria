// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";

describe("getOgFonts", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.doUnmock("node:fs/promises"));

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
  });
});

/**
 * These assets are 958,836 bytes of TTF and 69,889 bytes of PNG that used to be
 * read, and in the PNG's case base64-encoded, on EVERY OG render — five routes,
 * every social crawl, every share-card request. The cache is the only
 * performance change in the design system v2 rebuild, so it is asserted at the
 * filesystem boundary rather than by reading the source.
 */
describe("OG asset reads are cached per process", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.doUnmock("node:fs/promises"));

  it("reads each font file once no matter how many renders ask", async () => {
    const actual =
      await vi.importActual<typeof import("node:fs/promises")>(
        "node:fs/promises",
      );
    const spy = vi.fn((file: string) => actual.readFile(file));
    vi.doMock("node:fs/promises", () => ({ readFile: spy }));

    const { getOgFonts } = await import("./og-fonts");
    const first = await getOgFonts();
    const readsAfterFirstCall = spy.mock.calls.length;
    const second = await getOgFonts();
    const third = await Promise.all([getOgFonts(), getOgFonts()]);

    expect(readsAfterFirstCall).toBe(2);
    expect(spy.mock.calls.length).toBe(readsAfterFirstCall);
    expect(first).toHaveLength(2);
    // Identical BUFFERS, not merely equal ones: a fresh copy per call would
    // mean the read was avoided but the memory was not.
    expect(second[0].data).toBe(first[0].data);
    expect(second[1].data).toBe(first[1].data);
    expect(third[0][0].data).toBe(first[0].data);

  });

  it("reads and base64-encodes the mark PNG once", async () => {
    const actual =
      await vi.importActual<typeof import("node:fs/promises")>(
        "node:fs/promises",
      );
    const spy = vi.fn((file: string) => actual.readFile(file));
    vi.doMock("node:fs/promises", () => ({ readFile: spy }));

    const { getOgMarkDataUri } = await import("./og-fonts");
    const first = await getOgMarkDataUri();
    const readsAfterFirstCall = spy.mock.calls.length;
    const second = await getOgMarkDataUri();

    expect(readsAfterFirstCall).toBe(1);
    expect(spy.mock.calls.length).toBe(readsAfterFirstCall);
    expect(first.startsWith("data:image/png;base64,")).toBe(true);
    expect(second).toBe(first);

  });

  it("does not cache a failure — a transient read error stays recoverable", async () => {
    const actual =
      await vi.importActual<typeof import("node:fs/promises")>(
        "node:fs/promises",
      );
    const spy = vi
      .fn((file: string) => actual.readFile(file))
      .mockRejectedValueOnce(new Error("EMFILE"));
    vi.doMock("node:fs/promises", () => ({ readFile: spy }));

    const { getOgFonts } = await import("./og-fonts");
    expect(await getOgFonts()).toEqual([]);
    expect(await getOgFonts()).toHaveLength(2);

  });
});

describe("NotoSansTC font file", () => {
  it("has TrueType glyf outlines (not CFF) for @vercel/og compatibility", async () => {
    const fontPath = path.resolve(
      process.cwd(),
      "src/assets/fonts/NotoSansTC-subset.ttf",
    );
    const buf = await readFile(fontPath);
    const magic = buf.readUInt32BE(0);
    const isCFF = magic === 0x4f54544f; // OTTO = CFF; Satori requires TrueType (0x00010000)
    expect(isCFF).toBe(false);
  });
});

describe("OG fonts are sans-only (D17)", () => {
  beforeEach(() => vi.resetModules());

  it("declares no serif face — satori loads files from disk, so a CJK serif is a 3rd MB", async () => {
    const { getOgFonts } = await import("./og-fonts");
    const fonts = await getOgFonts();

    for (const font of fonts) {
      expect(font.name.replace("sans-serif", "")).not.toMatch(/serif|ming|明體/i);
    }
  });
});
