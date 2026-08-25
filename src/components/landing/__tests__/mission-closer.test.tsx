/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/ui/photo-band", () => ({
  PhotoBand: ({
    children,
    ...rest
  }: {
    children: ReactNode;
    [key: string]: unknown;
  }) => <section {...rest}>{children}</section>,
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
    render(
      await MissionCloser({ brandCount: 700, locale: "zh-TW" }),
    );

    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading).toHaveTextContent("missionCloser.headline");

    const cta = screen.getByText("missionCloser.cta");
    expect(cta).toBeInTheDocument();
  });

  it("cta links to brands", async () => {
    render(
      await MissionCloser({ brandCount: 700, locale: "zh-TW" }),
    );

    const cta = screen.getByText("missionCloser.cta");
    expect(cta.closest("a")).toHaveAttribute("href", "/brands");
  });
});
