/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from "react";
import type { TrailEntry } from "@/lib/services/trails";
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/image", () => ({
  default: ({ fill: _fill, preload, ...props }: Record<string, unknown>) => (
    // eslint-disable-next-line @next/next/no-img-element -- mock
    <img alt="" data-preload={preload ? "true" : "false"} {...props} />
  ),
}));

const intl = vi.hoisted(() => ({ locale: "zh-TW" }));

vi.mock("next-intl/server", () => ({
  getLocale: async () => intl.locale,
  getTranslations: async () =>
    Object.assign((key: string) => key, {
      rich: (key: string) => key,
    }),
}));

vi.mock("@/i18n/navigation", () => ({
  Link: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("next-intl", () => ({
  useLocale: () => "zh-TW",
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/components/ui/photo-band", () => ({
  PhotoBand: ({
    children,
    ...rest
  }: {
    children: ReactNode;
    [key: string]: unknown;
  }) => <section {...rest}>{children}</section>,
}));

const HeroSection = (await import("../hero-section")).default;

function trail(
  slug: string,
  title: string,
  locale = "zh-TW",
  shortTitleEn?: string,
): TrailEntry {
  return {
    slug,
    frontmatter: { title, locale, shortTitleEn },
  } as unknown as TrailEntry;
}

const FIVE_TRAILS = [
  trail("desk", "書桌：每天坐下來的那張桌子"),
  trail("daily-bag", "每天出門的包：從包本身到掛在外面的小東西"),
  trail("reading-corner", "小空間的閱讀角"),
  trail("tea", "Tea at home: a slower afternoon"),
  trail("fifth", "第五條：不該出現"),
];

describe("HeroSection — the editorial opener", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    intl.locale = "zh-TW";
  });

  it("renders the original positioning copy with search retained", async () => {
    render(await HeroSection({ trails: [] }));

    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toBeInTheDocument();
    expect(heading).toHaveTextContent("headline");
    expect(screen.getByText("lede")).toBeInTheDocument();
    expect(
      screen.getByRole("searchbox", { name: "searchLabel" }),
    ).toBeInTheDocument();
  });

  it("carries one message: no subheadline", async () => {
    render(await HeroSection({ trails: [] }));

    expect(screen.queryByText("subheadline")).not.toBeInTheDocument();
  });

  it("keeps the lede as the first paragraph (DEV-1320)", async () => {
    const { container } = render(await HeroSection({ trails: [] }));

    expect(container.querySelector("p")).toHaveTextContent("lede");
  });

  it("keeps the zh headline from breaking mid-word", async () => {
    render(await HeroSection({ trails: [] }));

    expect(screen.getByRole("heading", { level: 1 })).toHaveClass(
      "break-keep",
    );
  });

  it("renders the first four trails as short-titled situation chips", async () => {
    render(await HeroSection({ trails: FIVE_TRAILS }));

    const list = screen.getByRole("list", { name: "situationsLabel" });
    const links = within(list).getAllByRole("link");
    expect(links).toHaveLength(4);
    expect(
      links.map((link) => [link.textContent, link.getAttribute("href")]),
    ).toEqual([
      ["書桌", "/style/desk"],
      ["每天出門的包", "/style/daily-bag"],
      ["小空間的閱讀角", "/style/reading-corner"],
      ["Tea at home", "/style/tea"],
    ]);
  });

  it("renders no chip list when there are no trails", async () => {
    render(await HeroSection({ trails: [] }));

    expect(
      screen.queryByRole("list", { name: "situationsLabel" }),
    ).not.toBeInTheDocument();
  });

  it("marks zh-TW chips and notes the language on an English page", async () => {
    intl.locale = "en";
    render(await HeroSection({ trails: FIVE_TRAILS.slice(0, 2) }));

    const list = screen.getByRole("list", { name: "situationsLabel" });
    for (const link of within(list).getAllByRole("link")) {
      expect(link).toHaveAttribute("lang", "zh-Hant-TW");
    }
    expect(screen.getByText("situationsLanguageNote")).toBeInTheDocument();
    expect(list).toHaveClass("mt-2");
  });

  it("labels a chip with its shortTitleEn on an English page", async () => {
    intl.locale = "en";
    render(
      await HeroSection({
        trails: [
          trail("desk", "書桌：每天坐下來的那張桌子", "zh-TW", "Desk"),
          trail("daily-bag", "每天出門的包：從包本身到掛在外面的小東西"),
        ],
      }),
    );

    const list = screen.getByRole("list", { name: "situationsLabel" });
    const [desk, bag] = within(list).getAllByRole("link");
    expect(desk).toHaveTextContent("Desk");
    expect(desk).not.toHaveAttribute("lang");
    // No English label: the zh-TW short title, marked for screen readers.
    expect(bag).toHaveTextContent("每天出門的包");
    expect(bag).toHaveAttribute("lang", "zh-Hant-TW");
    // The trails still open in zh-TW.
    expect(screen.getByText("situationsLanguageNote")).toBeInTheDocument();
  });

  it("keeps the zh-TW short title on a zh-TW page", async () => {
    render(
      await HeroSection({
        trails: [trail("desk", "書桌：每天坐下來的那張桌子", "zh-TW", "Desk")],
      }),
    );

    expect(screen.getByRole("link", { name: "書桌" })).toBeInTheDocument();
  });

  it("adds no language note or chip lang on a zh-TW page", async () => {
    render(await HeroSection({ trails: FIVE_TRAILS.slice(0, 2) }));

    const list = screen.getByRole("list", { name: "situationsLabel" });
    for (const link of within(list).getAllByRole("link")) {
      expect(link).not.toHaveAttribute("lang");
    }
    expect(
      screen.queryByText("situationsLanguageNote"),
    ).not.toBeInTheDocument();
  });
});
