/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/image", () => ({
  default: ({ fill: _fill, preload, ...props }: Record<string, unknown>) => (
    // eslint-disable-next-line @next/next/no-img-element -- mock
    <img alt="" data-preload={preload ? "true" : "false"} {...props} />
  ),
}));

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
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

vi.mock("@/components/brands/search-input", () => ({
  SearchInput: (props: Record<string, unknown>) => (
    <div data-testid="search-input" {...props} />
  ),
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

describe("HeroSection — the editorial opener", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the original positioning copy with search retained", async () => {
    render(await HeroSection());

    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toBeInTheDocument();
    expect(heading).toHaveTextContent("headline");
    expect(screen.getByText("subheadline")).toBeInTheDocument();
    expect(screen.getByText("lede")).toBeInTheDocument();
    expect(screen.getByTestId("search-input")).toBeInTheDocument();
  });

  it("offers style discovery beside the search field", async () => {
    render(await HeroSection());

    expect(screen.getByText("browsePrefix")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /browseCta/ })).toHaveAttribute(
      "href",
      "/discover",
    );
  });
});
