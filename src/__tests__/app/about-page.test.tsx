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

const PAGE_PATH = resolve(
  import.meta.dirname,
  "../../app/[locale]/(site)/about/page.tsx",
);
const source = readFileSync(PAGE_PATH, "utf8");

describe("/about page", () => {
  it("renders the four scenes as paragraphs, not headings", () => {
    // The page iterates SCENE_KEYS via a template expression. Verify the
    // array contains all four keys.
    expect(source).toContain('"intention"');
    expect(source).toContain('"encounter"');
    expect(source).toContain('"alternatives"');
    expect(source).toContain('"adjacent"');

    // The scene text is rendered inside a <p>, not an <h> tag.
    // Source pattern: <p className="type-section">\n{t(`scenes.items.${key}.scene`)}
    const sceneBlock = source.slice(
      source.indexOf("{/* Scenes */}"),
      source.indexOf("{/* Loop */}"),
    );
    expect(sceneBlock).toContain("scenes.items.");
    // The individual scene items use <p>, never <h2>/<h3>. The section heading
    // is allowed to be an h2, so we check specifically for `.items.` expressions.
    expect(sceneBlock).not.toMatch(/<h[23][^>]*>[^<]*scenes\.items/);
    // Confirm the <p> wrapper is present.
    expect(sceneBlock).toMatch(/<p className="type-section">\s*\{t\(`scenes\.items\.\$\{key\}\.scene`\)\}/);
  });

  it("renders the four commitments as paragraphs, not headings", () => {
    expect(source).toContain('"boundary"');
    expect(source).toContain('"noPayToWin"');
    expect(source).toContain('"incomplete"');
    expect(source).toContain('"judgment"');

    const stanceBlock = source.slice(
      source.indexOf("{/* Stance */}"),
      source.indexOf("{/* Closing CTA */}"),
    );
    expect(stanceBlock).toContain("stance.items.");
    expect(stanceBlock).not.toMatch(/<h[23][^>]*>[^<]*stance\.items/);
    expect(stanceBlock).toMatch(/<p className="type-section">\s*\{t\(`stance\.items\.\$\{key\}\.lead`\)\}/);
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
