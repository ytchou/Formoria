/**
 * @vitest-environment jsdom
 *
 * Source-level assertions on the /about page composition.
 *
 * The page is an async server component whose body calls service functions.
 * Rendering it in JSDOM would require mocking the service layer, which
 * check-test-boundaries blocks. Instead we read page.tsx as text and assert
 * structural invariants — the same pattern landing-page.test.tsx uses for the
 * degraded-render wiring.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import zhTW from "../../../messages/zh-TW.json";

const PAGE_PATH = resolve(
  import.meta.dirname,
  "../../app/[locale]/(site)/about/page.tsx",
);
const source = readFileSync(PAGE_PATH, "utf8");
const heroSource = readFileSync(
  resolve(import.meta.dirname, "../../components/about/about-hero.tsx"),
  "utf8",
);

type MessageNode = { [key: string]: string | MessageNode };
const CATALOGUES = {
  "zh-TW": (zhTW as unknown as MessageNode).about as MessageNode,
  en: (en as unknown as MessageNode).about as MessageNode,
};

function strings(node: MessageNode): string[] {
  return Object.values(node).flatMap((value) =>
    typeof value === "string" ? [value] : strings(value),
  );
}

function at(node: MessageNode, path: string): string {
  const value = path
    .split(".")
    .reduce<string | MessageNode>((n, key) => (n as MessageNode)[key], node);
  if (typeof value !== "string") throw new Error(`${path} is not a string`);
  return value;
}

describe("/about copy (DEV-1958)", () => {
  it.each(Object.entries(CATALOGUES))(
    "%s: the title leaves the brand to the layout template",
    (_, about) => {
      // The layout template appends "| Formoria"; a title that names the brand
      // renders it twice.
      expect(at(about, "metadata.title")).not.toMatch(/Formoria/);
    },
  );

  it.each(Object.entries(CATALOGUES))(
    "%s: the stats line is whole sentences with distinct periods",
    (_, about) => {
      expect(at(about, "hero.recentWeek")).not.toBe(
        at(about, "hero.recentMonth"),
      );
      for (const key of ["recentWeek", "recentMonth", "statsBrands"]) {
        expect(at(about, `hero.${key}`)).toMatch(/\{count/);
      }
      expect(at(about, "hero.statsBoth")).toMatch(/\{brands.*\{categories/);
    },
  );

  it.each(Object.entries(CATALOGUES))(
    "%s: the hero title has no hard newline",
    (_, about) => {
      expect(at(about, "hero.title")).not.toContain("\n");
    },
  );

  it("zh-TW: one self-description, and 收錄 never blurred with 選物", () => {
    const all = strings(CATALOGUES["zh-TW"]).join("\n");
    expect(all).not.toContain("不是平台");
    expect(all).not.toContain("選品");
    expect(all).not.toContain("上架");
    expect(all).not.toContain("這裡是選出來的");
    expect(all).not.toContain("最安靜");
    expect(at(CATALOGUES["zh-TW"], "loop.body1")).toContain(
      "台灣好物選物平台",
    );
  });

  it("en: uses the canonical scene line and no platform denial", () => {
    const all = strings(CATALOGUES.en).join("\n");
    expect(all).not.toMatch(/not a platform/i);
    expect(all).not.toMatch(/look a little more like you/i);
    expect(at(CATALOGUES.en, "hero.title")).toContain("styling a shop");
  });

  it("exits product-led: hero to /discover, closing band to /style", () => {
    const ctaStart = source.indexOf("{/* Closing CTA */}");
    const closing = source.slice(ctaStart);
    expect(closing.indexOf("routes.style()")).toBeGreaterThan(-1);
    expect(closing.indexOf("routes.style()")).toBeLessThan(
      closing.indexOf("routes.brands()"),
    );
    expect(heroSource.indexOf("routes.discover()")).toBeGreaterThan(-1);
    expect(heroSource.indexOf("routes.discover()")).toBeLessThan(
      heroSource.indexOf("routes.brands()"),
    );
  });
});

describe("/about page", () => {
  it("renders the four scenes as paragraphs, not headings", () => {
    // The page iterates SCENE_KEYS via a template expression. Verify the
    // array contains all four keys.
    expect(source).toContain('"intention"');
    expect(source).toContain('"encounter"');
    expect(source).toContain('"alternatives"');
    expect(source).toContain('"adjacent"');

    // The scene text is rendered inside a <p>, not an <h> tag.
    // Source pattern: <p className="type-card-title ...">\n{t(`scenes.items.${key}.scene`)}
    const scenesStart = source.indexOf("{/* Scenes */}");
    const loopStart = source.indexOf("{/* Loop */}");
    expect(scenesStart).toBeGreaterThan(-1);
    expect(loopStart).toBeGreaterThan(scenesStart);
    const sceneBlock = source.slice(scenesStart, loopStart);
    expect(sceneBlock).toContain("scenes.items.");
    // The individual scene items use <p>, never <h2>/<h3>. The section heading
    // is allowed to be an h2, so we check specifically for `.items.` expressions.
    expect(sceneBlock).not.toMatch(/<h[23][^>]*>[^<]*scenes\.items/);
    // Confirm the <p> wrapper is present.
    expect(sceneBlock).toMatch(/<p className="type-card-title[^"]*">\s*\{t\(`scenes\.items\.\$\{key\}\.scene`\)\}/);
  });

  it("renders the four commitments as paragraphs, not headings", () => {
    expect(source).toContain('"boundary"');
    expect(source).toContain('"noPayToWin"');
    expect(source).toContain('"incomplete"');
    expect(source).toContain('"judgment"');

    const stanceStart = source.indexOf("{/* Stance */}");
    const ctaStart = source.indexOf("{/* Closing CTA */}");
    expect(stanceStart).toBeGreaterThan(-1);
    expect(ctaStart).toBeGreaterThan(stanceStart);
    const stanceBlock = source.slice(stanceStart, ctaStart);
    expect(stanceBlock).toContain("stance.items.");
    expect(stanceBlock).not.toMatch(/<h[23][^>]*>[^<]*stance\.items/);
    expect(stanceBlock).toMatch(/<p className="type-card-title[^"]*">\s*\{t\(`stance\.items\.\$\{key\}\.lead`\)\}/);
  });

  it("emits Organization JSON-LD and no Article JSON-LD", () => {
    const ldJsonMatches = source.match(/type="application\/ld\+json"/g);
    expect(ldJsonMatches).toHaveLength(1);

    expect(source).toContain("organizationJsonLd");
    expect(source).not.toContain("buildArticleJsonLd");
    expect(source).not.toContain("articleJsonLd");
  });

  it("renders no trust-label badge", () => {
    expect(source).not.toContain("SurfaceCard");
    expect(source).not.toContain("AboutCard");
    expect(source).not.toContain("Badge");
    expect(source).not.toContain("trust-label");
    expect(source).not.toContain('"trust.');
  });
});
