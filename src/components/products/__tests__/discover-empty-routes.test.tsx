/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from "react";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/i18n/navigation", () => ({
  Link: ({
    href,
    children,
    prefetch: _prefetch,
    ...rest
  }: {
    href: string;
    children: ReactNode;
    prefetch?: boolean;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { DiscoverEmptyRoutes } = await import("../discover-empty-routes");

const categories = [
  { slug: "home", label: "Home" },
  { slug: "apparel", label: "Apparel" },
];

const trails = [
  { slug: "slow-mornings", title: "Slow mornings", lang: "zh-Hant-TW" },
  { slug: "desk-setup", title: "Desk setup" },
];

describe("DiscoverEmptyRoutes", () => {
  it("renders the trail links and the category chips", () => {
    render(
      <DiscoverEmptyRoutes
        trails={trails}
        categories={categories}
        trailsHeading="Start from a style"
        categoriesHeading="Browse all products by category"
      />,
    );

    expect(
      screen.getByRole("heading", { level: 2, name: "Start from a style" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Browse all products by category",
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Slow mornings" }).getAttribute("href"),
    ).toBe("/style/slow-mornings");
    expect(
      screen.getByRole("link", { name: "Desk setup" }).getAttribute("href"),
    ).toBe("/style/desk-setup");
  });

  it("points each category chip at the filtered /discover listing", () => {
    render(
      <DiscoverEmptyRoutes
        trails={trails}
        categories={categories}
        trailsHeading="Start from a style"
        categoriesHeading="Browse all products by category"
      />,
    );

    expect(
      screen.getByRole("link", { name: "Home" }).getAttribute("href"),
    ).toBe("/discover?category=home");
    expect(
      screen.getByRole("link", { name: "Apparel" }).getAttribute("href"),
    ).toBe("/discover?category=apparel");
    // Chips render inside the row list, one per item.
    const homeItem = screen.getByRole("link", { name: "Home" }).closest("li");
    expect(homeItem?.parentElement?.tagName).toBe("UL");
  });

  it("omits the trails section when there are no trails", () => {
    render(
      <DiscoverEmptyRoutes
        trails={[]}
        categories={categories}
        trailsHeading="Start from a style"
        categoriesHeading="Browse all products by category"
      />,
    );

    expect(
      screen.queryByRole("heading", { name: "Start from a style" }),
    ).toBeNull();
    expect(
      screen.getByRole("heading", { name: "Browse all products by category" }),
    ).toBeTruthy();
  });

  it("marks a trail title's language when it differs from the page", () => {
    render(
      <DiscoverEmptyRoutes
        trails={trails}
        categories={categories}
        trailsHeading="Start from a style"
        categoriesHeading="Browse all products by category"
      />,
    );

    const tagged = within(
      screen.getByRole("link", { name: "Slow mornings" }),
    ).getByText("Slow mornings");
    expect(tagged.getAttribute("lang")).toBe("zh-Hant-TW");
    const untagged = within(
      screen.getByRole("link", { name: "Desk setup" }),
    ).getByText("Desk setup");
    expect(untagged.hasAttribute("lang")).toBe(false);
  });
});
