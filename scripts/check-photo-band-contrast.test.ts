import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import sharp from "sharp";
import { afterAll, describe, expect, it } from "vitest";

import { contrastFromLuminance, relativeLuminance } from "./lib/color.mjs";

import {
  REPO_ROOT,
  analyzeFiles,
  analyzePublishedTrailSource,
  analyzeSource,
  assertRgbPixels,
  breakpointLabel,
  brightestCompositedLuminance,
  darkestCompositedLuminance,
  isHandRolledScrim,
  loadBandPixels,
  opaqueScrimContrastRatio,
  readTypeRoleForeground,
  readTypeRoleInk,
  resolveBandInk,
  resolveResponsiveForeground,
  verticalScrimAlphaAt,
  visibleSourceRect,
  worstCompositedLuminance,
} from "./check-photo-band-contrast";
import {
  PHOTO_BAND_SCRIMS,
  scrimBreakpoints,
  type ScrimVariant,
} from "../src/lib/design/photo-band-scrims";

const VARIANTS = Object.keys(PHOTO_BAND_SCRIMS) as ScrimVariant[];
const GROUND: [number, number, number] = [0xfa, 0xf7, 0xf2];
const INK: [number, number, number] = [0x1a, 0x18, 0x15];
const INK_MUTED: [number, number, number] = [0x6f, 0x68, 0x5f];
const ON_INK: [number, number, number] = [0xd6, 0xcf, 0xc4];
const SURFACE_DARK: [number, number, number] = [0x2a, 0x28, 0x24];

const scratch = mkdtempSync(path.join(tmpdir(), "photo-band-gate-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function classes(source: string): string[] {
  return source.split(/\s+/).filter(Boolean);
}

describe("findBands — the JSX scanner", () => {
  it("reads literal props through an arrow-function prop", () => {
    // THE REGEX FAILED HERE. `<PhotoBand …>` matched non-greedily to the FIRST
    // `>`, which an `onClick={() => …}` supplies before `image` is ever read —
    // so a correct band failed the gate with "needs literal image and scrim
    // props", a diagnosis whose remedy was already satisfied.
    const { bands, errors } = analyzeSource(
      "fixture.tsx",
      `export const A = () => (
         <PhotoBand
           onClick={() => track("band")}
           image="/images/x.webp"
           alt=""
           scrim="left"
         >
           <p className="type-body">copy</p>
         </PhotoBand>
       );`,
    );

    expect(errors).toEqual([]);
    expect(bands).toHaveLength(1);
    expect(bands[0]!.image).toBe("/images/x.webp");
    expect(bands[0]!.scrim).toBe("left");
  });

  it("fails a band whose image or scrim is computed", () => {
    const { bands, errors } = analyzeSource(
      "fixture.tsx",
      `export const A = () => <PhotoBand image={hero} alt="" scrim="left" />;`,
    );

    expect(bands).toEqual([]);
    expect(errors[0]).toContain("needs literal `image` and `scrim` props");
  });

  it("rejects a remote image by name instead of dying in sharp", () => {
    // The prop's docblock used to say "or an allowed remote host", and a caller
    // who believed it got `path.join(PUBLIC_DIR, "https://…")` and a raw ENOENT
    // stack trace that named neither the component nor the constraint.
    const { bands, errors } = analyzeSource(
      "fixture.tsx",
      `export const A = () => (
         <PhotoBand image="https://cdn.example.com/a.webp" alt="" scrim="flat" />
       );`,
    );

    expect(bands).toEqual([]);
    expect(errors[0]).toContain("must be a repo path under /public");
  });

  it("rejects an unknown variant", () => {
    const { errors } = analyzeSource(
      "fixture.tsx",
      `export const A = () => <PhotoBand image="/a.webp" alt="" scrim="diagonal" />;`,
    );

    expect(errors[0]).toContain('unknown scrim variant "diagonal"');
  });
});

describe("findHandRolledScrims — the ban", () => {
  it("catches the construction however the classes are assembled", () => {
    // Each of these evaded the `className="…"` regex the ban shipped with.
    const evasions = [
      `const a = cn("absolute inset-0 bg-ground/85");`,
      "const b = `absolute inset-0 ${dark ? 'bg-ground/90' : 'bg-ground/70'}`;",
      `const c = "absolute inset-0 bg-[var(--ground)]/85";`,
      `const d = <span className={cn("absolute", "inset-0", "bg-gradient-to-t")} />;`,
      `const e = "absolute inset-x-0 bottom-0 bg-ground/94";`,
    ];

    for (const source of evasions) {
      const { handRolled } = analyzeSource("fixture.tsx", source);
      expect(handRolled, source).toHaveLength(1);
    }
  });

  it("scans .ts as well as .tsx", () => {
    // A class list lives just as happily in a `.ts` helper, which
    // `collectSourceFiles` used to skip entirely.
    const { handRolled } = analyzeSource(
      "fixture.ts",
      `export const scrim = "absolute inset-0 bg-ground/85";`,
    );

    expect(handRolled).toHaveLength(1);
  });

  it("leaves overlays that are not scrims alone", () => {
    // The predicate needs all three parts. A click target, a focus ring and a
    // modal backdrop all cover their box; none is a wash over a photograph,
    // and flagging them would make the ban unusable.
    expect(isHandRolledScrim(classes("absolute inset-0"))).toBe(false);
    expect(isHandRolledScrim(classes("absolute inset-0 rounded-[3px]"))).toBe(
      false,
    );
    expect(isHandRolledScrim(classes("absolute inset-0 bg-ground"))).toBe(
      false,
    );
    expect(
      isHandRolledScrim(classes("fixed inset-0 z-50 bg-black/10")),
      "a dialog backdrop covers the viewport, not a photograph",
    ).toBe(false);
    expect(isHandRolledScrim(classes("absolute bottom-0 bg-ground/85"))).toBe(
      false,
    );
  });

  it("exempts the two measured-scrim files from the hand-rolled ban", () => {
    const result = analyzeFiles([
      {
        file: "src/components/landing/trail-tile.tsx",
        source: `export const Tile = () => <span className="absolute inset-0 bg-gradient-to-t from-ink/95" />;`,
      },
      {
        file: "src/components/brands/selected-product-tile.tsx",
        source: `export const Tile = () => <span className="absolute inset-0 bg-ground/95" />;`,
      },
      {
        file: "src/components/landing/unregistered-tile.tsx",
        source: `export const Tile = () => <span className="absolute inset-0 bg-ink/80" />;`,
      },
    ]);

    expect(result.handRolled.join("\n")).not.toContain("trail-tile.tsx");
    expect(result.handRolled.join("\n")).not.toContain(
      "selected-product-tile.tsx",
    );
    expect(result.handRolled.join("\n")).toContain("unregistered-tile.tsx");
  });
});

describe("ink roles", () => {
  const css = readFileSync(path.join(REPO_ROOT, "src/app/globals.css"), "utf8");
  const roleInk = readTypeRoleInk(css);

  it("reads the role-to-ink map out of globals.css", () => {
    expect(roleInk.get("type-body")).toBe("--ink-soft");
    expect(roleInk.get("type-eyebrow")).toBe("--ink-muted");
    expect(roleInk.get("type-page-title")).toBe("--ink");
  });

  it("resolves type-body to its CSS-declared ink role", () => {
    expect(resolveBandInk([["type-body"]], roleInk)).toContain("--ink-soft");
  });

  it("lets an explicit ink override the role's default", () => {
    expect(
      resolveBandInk([["type-eyebrow", "text-ink-soft"]], roleInk),
    ).not.toContain("--ink-muted");
  });

  it("resolves the real homepage opener to ink and ink-soft only", () => {
    const source = readFileSync(
      path.join(REPO_ROOT, "src/components/landing/hero-section.tsx"),
      "utf8",
    );
    const { bands } = analyzeSource("hero-section.tsx", source);

    expect(bands).toHaveLength(1);
    expect(resolveBandInk(bands[0]!.classLists, roleInk).sort()).toEqual([
      "--ink",
      "--ink-soft",
    ]);
  });
});

describe("responsive foreground roles", () => {
  const css = readFileSync(path.join(REPO_ROOT, "src/app/globals.css"), "utf8");
  const roleForeground = readTypeRoleForeground(css);

  it("lets an active responsive role replace base text, then a responsive token replace it", () => {
    const base = ["type-card-title", "text-ground", "md:type-section"];

    expect(resolveResponsiveForeground(base, roleForeground, 767)).toBe(
      "--ground",
    );
    expect(resolveResponsiveForeground(base, roleForeground, 768)).toBe(
      "--ink",
    );
    expect(
      resolveResponsiveForeground(
        [...base, "md:text-ground"],
        roleForeground,
        768,
      ),
    ).toBe("--ground");
  });
});

describe("object-cover crop model", () => {
  it("keeps full width and crops rows when the band is wider than the frame", () => {
    const rect = visibleSourceRect(1.776, 2.4);

    expect(rect.x0).toBe(0);
    expect(rect.x1).toBe(1);
    expect(rect.y1 - rect.y0).toBeCloseTo(1.776 / 2.4, 5);
  });

  it("shows a centred strip when the band is taller than the frame", () => {
    // 390px phone: the band is portrait, so the browser fills the height and
    // shows roughly the middle 42% of the frame. Every alpha the gate assigned
    // by source-x before this was assigned to a column nobody sees.
    const rect = visibleSourceRect(1.776, 0.75);

    expect(rect.y0).toBe(0);
    expect(rect.y1).toBe(1);
    expect(rect.x1 - rect.x0).toBeCloseTo(0.75 / 1.776, 5);
    expect(rect.x0 + rect.x1).toBeCloseTo(1, 5);
  });
});

describe("dark PhotoBand contrast", () => {
  it("keeps inverse text above AA over both luminance extremes at every breakpoint", () => {
    for (const breakpoint of scrimBreakpoints("dark")) {
      for (const underlying of [0, 255]) {
        const pixels = {
          data: Buffer.from([underlying, underlying, underlying]),
          width: 1,
          height: 1,
        };
        const background = worstCompositedLuminance(
          pixels,
          breakpoint,
          SURFACE_DARK,
          ON_INK,
        );

        expect(background).toBeDefined();
        expect(
          contrastFromLuminance(relativeLuminance(ON_INK), background!),
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe("trail-tile dark scrim model", () => {
  it("interpolates the declared vertical stops in rendered screen coordinates", () => {
    expect(verticalScrimAlphaAt(0)).toBeCloseTo(0.1, 6);
    expect(verticalScrimAlphaAt(0.25)).toBeCloseTo(0.75, 6);
    expect(verticalScrimAlphaAt(0.625)).toBeCloseTo(0.85, 6);
    expect(verticalScrimAlphaAt(1)).toBeCloseTo(0.95, 6);
  });

  it("samples the brightest one percent after object-cover and compositing", () => {
    const width = 10;
    const height = 10;
    const data = Buffer.alloc(width * height * 3);
    data[0] = 255;
    data[1] = 255;
    data[2] = 255;

    const measured = brightestCompositedLuminance(
      { data, width, height },
      { label: "fixture", minWidth: 0, bandAspect: 1, textZone: [0, 1] },
      INK,
    );
    const allBlack = brightestCompositedLuminance(
      { data: Buffer.alloc(width * height * 3), width, height },
      { label: "fixture", minWidth: 0, bandAspect: 1, textZone: [0, 1] },
      INK,
    );

    expect(measured).toBeDefined();
    expect(measured!).toBeGreaterThan(allBlack!);
  });
});

describe("published trail image contract", () => {
  it("rejects a missing or remote hero on a published trail", () => {
    const missing = analyzePublishedTrailSource(
      "content/trails/missing.mdx",
      "---\ndraft: false\n---\n",
    );
    const remote = analyzePublishedTrailSource(
      "content/trails/remote.mdx",
      "---\ndraft: false\nheroImage: https://cdn.example.com/trail.webp\n---\n",
    );

    expect(missing.errors.join("\n")).toContain("needs a local heroImage");
    expect(remote.errors.join("\n")).toContain(
      "must be a repo path under /public",
    );
  });

  it("registers a local published hero and ignores drafts", () => {
    const published = analyzePublishedTrailSource(
      "content/trails/reading.mdx",
      "---\ndraft: false\nheroImage: /images/trails/reading.webp\n---\n",
    );
    const draft = analyzePublishedTrailSource(
      "content/trails/draft.mdx",
      "---\ndraft: true\nheroImage: https://cdn.example.com/draft.webp\n---\n",
    );

    expect(published).toEqual({
      trail: {
        file: "content/trails/reading.mdx",
        image: "/images/trails/reading.webp",
      },
      errors: [],
    });
    expect(draft).toEqual({ errors: [] });
  });
});

describe("product caption plate", () => {
  it("keeps ink-muted above AA through 95% ground over pure black", () => {
    expect(
      opaqueScrimContrastRatio(INK, GROUND, [0, 0, 0], 0.95),
    ).toBeGreaterThan(4.5);
    expect(
      opaqueScrimContrastRatio(INK_MUTED, GROUND, [0, 0, 0], 0.95),
    ).toBeCloseTo(4.607, 3);
  });
});

describe("pixel normalisation", () => {
  it("refuses a buffer that is not three channels rather than guessing", () => {
    // SILENT-WRONG, MADE IMPOSSIBLE. On a one-channel image the old walk read
    // `data[offset + 1]` and `[offset + 2]` — the NEXT TWO PIXELS' greys — as
    // this pixel's green and blue, and printed a plausible ratio computed from
    // garbage. sharp normalises most inputs to three channels; this is the
    // backstop for the ones it does not.
    expect(() =>
      assertRgbPixels(
        "fixture",
        { length: 64 },
        {
          width: 8,
          height: 8,
          channels: 1,
        },
      ),
    ).toThrow(/expected 3 channels/);

    expect(() =>
      assertRgbPixels(
        "fixture",
        { length: 100 },
        {
          width: 8,
          height: 8,
          channels: 3,
        },
      ),
    ).toThrow(/shorter than/);
  });

  it("measures a greyscale image as its own grey, not its neighbours'", async () => {
    const file = path.join(scratch, "grey.png");
    await sharp({
      create: {
        width: 16,
        height: 16,
        channels: 3,
        background: { r: 20, g: 20, b: 20 },
      },
    })
      .toColourspace("b-w")
      .png()
      .toFile(file);

    const pixels = await loadBandPixels(file, GROUND);

    expect(pixels.width).toBe(16);
    for (let i = 0; i < 3 * 16; i += 3) {
      expect(pixels.data[i]).toBe(pixels.data[i + 1]);
      expect(pixels.data[i + 1]).toBe(pixels.data[i + 2]);
    }
  });

  it("composites transparency over the ground token", async () => {
    // A partly transparent photograph was scored as opaque, when the browser
    // shows `--ground` through it.
    const file = path.join(scratch, "clear.png");
    await sharp({
      create: {
        width: 16,
        height: 16,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .png()
      .toFile(file);

    const pixels = await loadBandPixels(file, GROUND);

    expect([pixels.data[0], pixels.data[1], pixels.data[2]]).toEqual(GROUND);
  });
});

describe("the gate as it runs", () => {
  it("measures every band at every breakpoint the spec declares", () => {
    // C1 WAS EXACTLY THIS GAP: the spec declared one zone, the gate checked
    // one zone, and the zone was a desktop measurement. A breakpoint the gate
    // does not print a line for is a breakpoint nothing is proving.
    const output = execFileSync(
      "pnpm",
      ["exec", "tsx", "scripts/check-photo-band-contrast.ts"],
      { cwd: REPO_ROOT, encoding: "utf8" },
    );

    for (const variant of VARIANTS) {
      if (!output.includes(`scrim="${variant}"`)) continue;
      for (const breakpoint of scrimBreakpoints(variant)) {
        expect(output, `${variant} @ ${breakpointLabel(breakpoint)}`).toContain(
          `scrim="${variant}" · ${breakpointLabel(breakpoint)}`,
        );
      }
    }

    expect(output).toContain("at every declared breakpoint");
    expect(output).toContain("trail-tile · /images/trails/");
    expect(output).toContain(
      "trail-tile · /images/trails/small-space-reading-corner.webp · base (narrow)",
    );
    expect(output).toContain(
      "trail-tile · /images/trails/small-space-reading-corner.webp · min-width:768px",
    );
    expect(output).toContain(
      "product-caption · pure-black pixel · --ink-muted",
    );
  }, 120_000);

  it("reads a different set of pixels at each breakpoint", async () => {
    // The two entries of `flat` carry identical stops and zones and differ only
    // in `bandAspect`. If those produced the same measurement, the crop model
    // would not be doing anything.
    const pixels = await loadBandPixels(
      path.join(REPO_ROOT, "public/images/manifesto-bg.webp"),
      GROUND,
    );
    const [narrow, wide] = scrimBreakpoints("flat");

    expect(darkestCompositedLuminance(pixels, narrow!, GROUND)).not.toBeCloseTo(
      darkestCompositedLuminance(pixels, wide!, GROUND)!,
      6,
    );
  });
});
