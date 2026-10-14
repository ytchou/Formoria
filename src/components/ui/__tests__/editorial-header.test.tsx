// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { EditorialHeader } from "@/components/ui/editorial-header";

// `next/image` becomes a plain `img`, as in `editorial-hero.test.tsx`. The hero
// is the route's LCP element, so the mock forwards `priority` and
// `fetchPriority` as data attributes the assertions can reach.
vi.mock("next/image", () => ({
  default: ({
    fill: _fill,
    priority,
    fetchPriority,
    ...props
  }: Record<string, unknown>) => (
    // eslint-disable-next-line @next/next/no-img-element -- this IS the mock of next/image
    <img
      alt=""
      data-priority={priority ? "true" : "false"}
      data-fetch-priority={String(fetchPriority ?? "")}
      {...props}
    />
  ),
}));

vi.mock("@/i18n/navigation", () => ({
  Link: ({
    href,
    prefetch: _prefetch,
    children,
    ...rest
  }: {
    href: string;
    prefetch?: boolean;
    children: ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// `brand-breadcrumb.tsx` also exports the async `BrandBreadcrumb`, which reads
// server translations; the shared `Breadcrumb` this header renders does not.
vi.mock("next-intl/server", () => ({ getTranslations: vi.fn() }));

const HERO = "/images/stories/2026-taiwan-creative-expo-craft-brands.webp";

const baseProps = {
  breadcrumbAriaLabel: "目前位置",
  breadcrumbItems: [
    { label: "專題", href: "/stories" },
    { label: "文博會分類導覽", lang: "zh-TW" },
  ],
  title: "文博會分類導覽",
  lede: "從六個分類看這次文博會。",
  metaItems: [
    { label: "作者", value: "Formoria 編輯團隊" },
    { label: "發布日期", value: "2026/10/01" },
  ],
};

describe("EditorialHeader with a hero", () => {
  it("opens on the scene image and never defers the LCP element", () => {
    render(
      <EditorialHeader
        {...baseProps}
        hero={{ src: HERO, alt: "六件台灣工藝" }}
      />,
    );

    const image = screen.getByAltText("六件台灣工藝");
    expect(image).toHaveAttribute("src", HERO);
    expect(image).toHaveAttribute("data-priority", "true");
    expect(image).toHaveAttribute("data-fetch-priority", "high");
    expect(image).toHaveAttribute("sizes", "100vw");
  });

  it("passes a route's image quality through", () => {
    render(
      <EditorialHeader
        {...baseProps}
        hero={{ src: HERO, alt: "六件台灣工藝", quality: 60 }}
      />,
    );

    expect(screen.getByAltText("六件台灣工藝")).toHaveAttribute(
      "quality",
      "60",
    );
  });

  it("sets the title and lede on the scrim", () => {
    render(
      <EditorialHeader {...baseProps} hero={{ src: HERO, alt: "" }} />,
    );

    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent("文博會分類導覽");
    expect(heading.className).toContain("text-ground");
    expect(screen.getByText("從六個分類看這次文博會。").className).toContain(
      "text-on-ink",
    );
  });

  it("draws ONE scrim layer, never the old two-part block and fade (EL-07)", () => {
    const { container } = render(
      <EditorialHeader {...baseProps} hero={{ src: HERO, alt: "" }} />,
    );

    expect(container.innerHTML).not.toContain("from-ink/90");
    expect(container.innerHTML).not.toContain("from-ink/80");
    const scrims = container.querySelectorAll(
      '[aria-hidden="true"][class*="linear-gradient(in_oklab"]',
    );
    expect(scrims).toHaveLength(1);
  });
});

describe("EditorialHeader without a hero", () => {
  it("sets the title and lede on the surface band", () => {
    const { container } = render(<EditorialHeader {...baseProps} hero={null} />);

    expect(container.querySelector("img")).toBeNull();
    expect(container.innerHTML).not.toContain("linear-gradient(in_oklab");
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent("文博會分類導覽");
    expect(heading.className).not.toContain("text-ground");
    expect(screen.getByText("從六個分類看這次文博會。")).toBeInTheDocument();
  });

  it("omits the lede when there is none", () => {
    const { container } = render(
      <EditorialHeader {...baseProps} lede={null} hero={null} />,
    );

    expect(container.querySelector(".type-lede")).toBeNull();
  });
});

describe("EditorialHeader frame", () => {
  it("renders the shared breadcrumb with the current page marked", () => {
    render(<EditorialHeader {...baseProps} hero={null} />);

    const nav = screen.getByRole("navigation", { name: "目前位置" });
    expect(within(nav).getByRole("link", { name: "專題" })).toHaveAttribute(
      "href",
      "/stories",
    );
    const current = within(nav).getByText("文博會分類導覽");
    expect(current).toHaveAttribute("aria-current", "page");
    expect(current).toHaveAttribute("lang", "zh-TW");
  });

  it("renders the meta line as one line with hidden separators", () => {
    const { container } = render(
      <EditorialHeader {...baseProps} hero={null} />,
    );

    expect(screen.getByText("Formoria 編輯團隊")).toBeInTheDocument();
    expect(screen.getByText("2026/10/01")).toBeInTheDocument();
    // A line, not the five-row table it replaced on stories (DS-08).
    expect(container.querySelector("dl")).toBeNull();
    const separators = container.querySelectorAll('[aria-hidden="true"]');
    expect(
      [...separators].filter((node) => node.textContent === "·"),
    ).toHaveLength(1);
  });

  it("puts the notice outside the content-language wrapper", () => {
    render(
      <EditorialHeader
        {...baseProps}
        contentLang="zh-TW"
        notice="This story is written in Traditional Chinese."
        hero={null}
      />,
    );

    const notice = screen.getByText(
      "This story is written in Traditional Chinese.",
    );
    expect(notice.closest("[lang]")).toBeNull();
    expect(
      screen.getByRole("heading", { level: 1 }).closest("[lang]"),
    ).toHaveAttribute("lang", "zh-TW");
  });

  it("is a header band with a rule", () => {
    const { container } = render(
      <EditorialHeader {...baseProps} hero={null} />,
    );

    const header = container.querySelector("header");
    expect(header?.className).toContain("bg-surface");
    expect(header?.className).toContain("border-rule");
  });
});
