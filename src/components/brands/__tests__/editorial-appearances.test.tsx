/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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

vi.mock("@/lib/analytics", () => ({
  trackStoryCardClicked: vi.fn(),
  trackTrailCardClicked: vi.fn(),
}));

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));

const { EditorialAppearances } = await import("../editorial-appearances");

const trails = [
  { slug: "slow-mornings", title: "慢慢醒來的早晨", locale: "zh-TW" },
];
const stories = [{ slug: "expo-guide", title: "展覽導覽", locale: "zh-TW" }];

describe("EditorialAppearances", () => {
  it("renders nothing when there are no trails or stories", async () => {
    expect(
      await EditorialAppearances({ locale: "en", trails: [], stories: [] }),
    ).toBeNull();
  });

  it("marks zh-only titles and shows the note once on EN pages", async () => {
    render(await EditorialAppearances({ locale: "en", trails, stories }));

    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      "editorialAppearances.heading",
    );
    expect(screen.getAllByText("editorialAppearances.zhOnlyNote")).toHaveLength(
      1,
    );
    expect(screen.getByText("慢慢醒來的早晨")).toHaveAttribute(
      "lang",
      "zh-Hant-TW",
    );
    expect(screen.getByText("展覽導覽")).toHaveAttribute("lang", "zh-Hant-TW");
    // The links stay: hiding them would leave an empty section.
    expect(screen.getAllByRole("link")).toHaveLength(2);
  });

  it("adds no lang attribute or note on zh pages", async () => {
    render(await EditorialAppearances({ locale: "zh-TW", trails, stories }));

    expect(
      screen.queryByText("editorialAppearances.zhOnlyNote"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("慢慢醒來的早晨")).not.toHaveAttribute("lang");
    expect(screen.getByText("展覽導覽")).not.toHaveAttribute("lang");
  });

  it("marks each title by its own content locale", async () => {
    render(
      await EditorialAppearances({
        locale: "en",
        trails: [
          { slug: "slow-mornings", title: "Slow mornings", locale: "en" },
        ],
        stories,
      }),
    );

    expect(screen.getByText("Slow mornings")).not.toHaveAttribute("lang");
    expect(screen.getByText("展覽導覽")).toHaveAttribute("lang", "zh-Hant-TW");
    expect(screen.getAllByText("editorialAppearances.zhOnlyNote")).toHaveLength(
      1,
    );
  });

  it("marks an en title on a zh page and shows no zh-only note", async () => {
    render(
      await EditorialAppearances({
        locale: "zh-TW",
        trails: [
          { slug: "slow-mornings", title: "Slow mornings", locale: "en" },
        ],
        stories: [],
      }),
    );

    expect(screen.getByText("Slow mornings")).toHaveAttribute("lang", "en");
    expect(
      screen.queryByText("editorialAppearances.zhOnlyNote"),
    ).not.toBeInTheDocument();
  });
});
