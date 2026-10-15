/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The real band, so the scrim class it paints is what the test reads;
// `next/image` becomes a plain `img`.
vi.mock("next/image", () => ({
  default: ({
    fill: _fill,
    preload: _preload,
    ...props
    // eslint-disable-next-line @next/next/no-img-element -- this IS the mock of next/image
  }: Record<string, unknown>) => <img alt="" {...props} />,
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

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));

vi.mock("@/components/ui/button", () => ({
  buttonVariants: () => "btn",
}));

const { default: MissionCloser } = await import("../mission-closer");

describe("MissionCloser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders headline and cta", async () => {
    render(await MissionCloser());

    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading).toHaveTextContent("missionCloser.headline");

    const cta = screen.getByText("missionCloser.cta");
    expect(cta).toBeInTheDocument();
  });

  it("is a dark photographic beat with inverse, left-aligned copy", async () => {
    const { container } = render(await MissionCloser());

    expect(container.querySelector(".photo-band-scrim-dark")).not.toBeNull();
    expect(container.querySelector(".photo-band-scrim-flat")).toBeNull();

    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading).toHaveClass("text-on-ink");
    expect(heading).not.toHaveClass("mx-auto");
    expect(screen.getByText("missionCloser.subtitle")).toHaveClass(
      "text-on-ink",
    );
    expect(container.querySelector(".text-center")).toBeNull();
  });

  it("cta links to brands", async () => {
    render(await MissionCloser());

    const cta = screen.getByText("missionCloser.cta");
    expect(cta.closest("a")).toHaveAttribute("href", "/brands");
  });
});
