// @vitest-environment jsdom
import { createElement } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { createStoryComponentMap } from "./components";

/**
 * DEV-2026 EL-09 / EL-10: the editorial layout the map adds on wide screens.
 *
 * Asserted by ACCESSIBLE NAME, not markup, because that is the contract the
 * layout must not break: the trail page's e2e resolves each section heading
 * with `getByRole('heading', { name: title, exact: true })`, and a story
 * heading split into a marker and a title must still be announced whole.
 */
describe("story h2 — material marker (EL-10)", () => {
  it("hangs the part before ｜ as a decorative marker and keeps the full name", () => {
    const map = createStoryComponentMap();
    render(map.h2({ children: "陶｜這一窯 Huiaio studio" }));

    const heading = screen.getByRole("heading", {
      level: 2,
      name: "陶｜這一窯 Huiaio studio",
    });
    const marker = heading.querySelector('[aria-hidden="true"]');
    expect(marker?.textContent).toBe("陶");
    expect(marker?.className).toContain("font-ming");
    expect(marker?.className).toContain("text-rule");
    expect(marker?.className).toContain("xl:absolute");
    expect(heading.className).toContain("relative");
  });

  it("renders a heading without ｜ exactly as before", () => {
    const map = createStoryComponentMap();
    const { container } = render(map.h2({ children: "為什麼是這幾家" }));

    expect(container.innerHTML).toBe(
      '<h2 class="mt-10 mb-3 scroll-mt-24 type-section">為什麼是這幾家</h2>',
    );
  });

  it("leaves a trail's undeclared ｜ heading unsplit", () => {
    const map = createStoryComponentMap({
      trailSections: [{ key: "a", title: "別的標題" }],
    });
    const { container } = render(map.h2({ children: "陶｜這一窯" }));

    expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
  });
});

describe("trail section — rail layout (EL-09)", () => {
  const sections = [
    { key: "writing-tools", title: "每天拿起來的筆" },
    { key: "desk-surface", title: "筆和紙底下的桌面" },
  ];

  function renderSection() {
    const map = createStoryComponentMap({ trailSections: sections });
    return render(
      map.TrailSection({
        id: "desk-surface",
        children: [
          createElement(map.h2, { key: "h" }, "筆和紙底下的桌面"),
          createElement(map.p, { key: "p1" }, "第一段。"),
          createElement(map.p, { key: "p2" }, "第二段。"),
          createElement(map.TrailProducts, { key: "s", section: "desk-surface" }),
        ],
      }),
    );
  }

  it("keeps the heading's accessible name exactly the section title", () => {
    renderSection();

    const heading = screen.getByRole("heading", {
      level: 2,
      name: "筆和紙底下的桌面",
    });
    const ordinal = heading.querySelector('[aria-hidden="true"]');
    expect(ordinal?.textContent).toBe("02");
    expect(ordinal?.className).toContain("lg:type-display");
    expect(ordinal?.className).toContain("text-ink-muted");
    expect(ordinal?.className).not.toContain("accent");
  });

  it("puts the heading in a sticky rail, the prose in the second track", () => {
    const { container } = renderSection();
    const section = container.querySelector("section#desk-surface");
    expect(section?.className).toContain(
      "lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]",
    );

    const rail = section?.querySelector('[data-slot="trail-rail"]');
    expect(rail?.className).toContain("lg:sticky");
    expect(rail?.querySelector("h2")).not.toBeNull();

    const prose = section?.querySelector('[data-slot="trail-prose"]');
    expect(prose?.className).toContain("lg:col-start-2");
    expect(prose?.querySelectorAll("p")).toHaveLength(2);
    expect(prose?.querySelector("p")?.className).toContain("prose-measure");
  });

  it("spans the product shelf across both tracks", () => {
    const { container } = renderSection();
    const shelf = container.querySelector('[data-slot="trail-shelf"]');

    expect(shelf?.className).toContain("lg:col-span-2");
  });

  it("keeps authoring order: prose after a shelf stays after it", () => {
    const map = createStoryComponentMap({ trailSections: sections });
    const { container } = render(
      map.TrailSection({
        id: "writing-tools",
        children: [
          createElement(map.h2, { key: "h" }, "每天拿起來的筆"),
          createElement(map.p, { key: "p1" }, "前。"),
          createElement(map.TrailProducts, { key: "s", section: "writing-tools" }),
          createElement(map.p, { key: "p2" }, "後。"),
        ],
      }),
    );
    const slots = [
      ...container.querySelectorAll("section > [data-slot]"),
    ].map((node) => node.getAttribute("data-slot"));

    expect(slots).toEqual([
      "trail-rail",
      "trail-prose",
      "trail-shelf",
      "trail-prose",
    ]);
  });

  it("passes a section without a heading through untouched", () => {
    const map = createStoryComponentMap({ trailSections: sections });
    const { container } = render(
      map.TrailSection({
        id: "bare",
        children: createElement(map.p, null, "只有一段。"),
      }),
    );

    expect(container.querySelector("[data-slot]")).toBeNull();
    expect(container.querySelector("section#bare > p")).not.toBeNull();
  });
});
