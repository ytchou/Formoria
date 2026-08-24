import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createStoryComponentMap } from "./components";

/**
 * The map is the ONLY styling surface under published prose — the three `.mdx`
 * files in `content/` carry no inline classes at all — so these assertions are
 * what stands between a type-role rename and every story silently reverting to
 * browser defaults.
 */
function markup(element: ReactElement): string {
  return renderToStaticMarkup(element);
}

describe("story component map — v2 type roles", () => {
  const map = createStoryComponentMap();

  it("maps markdown headings onto the v2 roles", () => {
    expect(markup(map.h1({ children: "Heading" }))).toContain(
      "type-page-title",
    );
    expect(markup(map.h2({ children: "Heading" }))).toContain("type-section");
    expect(markup(map.h3({ children: "Heading" }))).toContain(
      "type-card-title",
    );
    expect(markup(map.h4({ children: "Heading" }))).toContain("type-label");
  });

  it("sets body prose on the 明體 body role, not the small one", () => {
    const paragraph = markup(map.p({ children: "Body copy." }));
    expect(paragraph).toContain("type-body");
    expect(paragraph).not.toContain("type-body-sm");
    expect(paragraph).toContain("text-ink-soft");
  });

  it("keeps author classes rather than overwriting them", () => {
    expect(
      markup(map.h2({ children: "x", className: "text-center" })),
    ).toContain("text-center");
  });

  it("carries no v1 palette class on any mapped element", () => {
    // This list is the FORBIDDEN one — stock shadcn names that must never
    // reappear here. It is deliberately written as string literals the token
    // migration would rewrite if it treated them as live classes; they are
    // data, not styling, so any future sweep must skip this array.
    //
    // These names no longer resolve to anything: the stock @theme block is
    // gone. That makes a leftover render UNSTYLED rather than render correctly
    // and quietly ignore the v2 layer, which is the older and worse failure
    // this test was written for.
    const V1_PALETTE = [
      "border-border",
      "bg-secondary",
      "bg-muted",
      "bg-card",
      "text-foreground",
      "border-foreground",
      "bg-border",
      "ring-ring",
    ];
    const withChildren = [
      "h1",
      "h2",
      "h3",
      "h4",
      "p",
      "ul",
      "ol",
      "li",
      "a",
      "blockquote",
      "th",
      "td",
      "code",
      "pre",
    ] as const;
    // Void elements: React rejects `children` on them outright.
    const voids = ["hr", "img"] as const;
    const rendered = [
      ...withChildren.map((tag) =>
        markup(
          (map[tag] as unknown as (props: object) => ReactElement)({
            children: "x",
          }),
        ),
      ),
      ...voids.map((tag) =>
        markup(
          (map[tag] as unknown as (props: object) => ReactElement)({ alt: "" }),
        ),
      ),
    ].join("\n");

    // `table` renders separately: a bare text child inside `<table>` is invalid
    // DOM nesting and React says so loudly, which is noise, not a finding.
    const table = markup(map.table({ children: <tbody /> }));

    for (const legacy of V1_PALETTE) {
      expect(
        `${rendered}\n${table}`,
        `${legacy} survived in the MDX element map`,
      ).not.toContain(legacy);
    }
  });
});

describe("story component map — trail section numbers", () => {
  const sections = [
    { key: "light-first", title: "先讓光線到位" },
    { key: "beside-seat", title: "把需要的東西放在座位旁" },
  ];

  it("numbers a declared trail section beside its title", () => {
    const map = createStoryComponentMap({ trailSections: sections });
    const html = markup(map.h2({ children: "把需要的東西放在座位旁" }));

    expect(html).toContain("02");
    expect(html).toContain("把需要的東西放在座位旁");
    // Decorative ordinal only. The section nav resolves this heading by its
    // accessible name (`discovery-trail.spec.ts`), so the number must not join it.
    expect(html).toContain('aria-hidden="true"');
  });

  it("numbers a declared section whose heading contains inline markup", () => {
    const map = createStoryComponentMap({ trailSections: sections });
    const html = markup(
      map.h2({
        children: ["把需要的東西", <em key="emphasis">放在座位旁</em>],
      }),
    );

    expect(html).toContain("02");
    expect(html).toContain("<em>放在座位旁</em>");
  });

  it("leaves duplicate declared titles unnumbered", () => {
    const map = createStoryComponentMap({
      trailSections: [
        { key: "first", title: "重複標題" },
        { key: "second", title: " 重複標題 " },
      ],
    });
    const html = markup(map.h2({ children: "重複標題" }));

    expect(html).not.toContain("aria-hidden");
  });

  it("leaves an undeclared heading unnumbered", () => {
    const map = createStoryComponentMap({ trailSections: sections });
    const html = markup(map.h2({ children: "一段沒有宣告的標題" }));

    expect(html).not.toContain("01");
    expect(html).toContain("type-section");
  });

  it("numbers nothing on a story, which declares no sections", () => {
    const html = markup(
      createStoryComponentMap().h2({ children: "先讓光線到位" }),
    );

    expect(html).not.toContain("aria-hidden");
  });
});
