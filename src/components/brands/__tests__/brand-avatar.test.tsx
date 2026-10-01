/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/image", () => ({
  default: ({
    fill: _fill,
    priority: _priority,
    preload: _preload,
    ...props
  }: Record<string, unknown>) => (
    // eslint-disable-next-line @next/next/no-img-element -- this IS the mock of next/image
    <img alt="" {...props} />
  ),
}));

const { BrandAvatar } = await import("@/components/brands/brand-avatar");

describe("BrandAvatar", () => {
  it("renders the image with no initial while it loads", () => {
    const { container } = render(
      <BrandAvatar name="山間器物" imageSrc="/i/brands/shanjian/logo.jpg" />,
    );

    expect(container.querySelector("img")).not.toBeNull();
    expect(screen.queryByText("山")).toBeNull();
  });

  it("falls back to the initial when the image fails to load", () => {
    const { container } = render(
      <BrandAvatar name="山間器物" imageSrc="/i/brands/shanjian/logo.jpg" />,
    );

    const img = container.querySelector("img");
    if (!img) throw new Error("avatar rendered no img");
    fireEvent.error(img);

    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("山")).toBeInTheDocument();
  });

  it("retries when a new src replaces a failed one", () => {
    const { container, rerender } = render(
      <BrandAvatar name="山間器物" imageSrc="/i/brands/shanjian/logo.jpg" />,
    );
    const img = container.querySelector("img");
    if (!img) throw new Error("avatar rendered no img");
    fireEvent.error(img);

    rerender(
      <BrandAvatar name="山間器物" imageSrc="/i/brands/shanjian/logo-2.jpg" />,
    );

    expect(container.querySelector("img")).not.toBeNull();
  });

  it("renders the initial when there is no image", () => {
    render(<BrandAvatar name="山間器物" imageSrc={null} />);

    expect(screen.getByText("山")).toBeInTheDocument();
  });

  it("omits the name span when showName is false", () => {
    const shown = render(<BrandAvatar name="山間器物" imageSrc={null} />);
    expect(screen.getByText("山間器物")).toBeInTheDocument();
    shown.unmount();

    render(<BrandAvatar name="山間器物" imageSrc={null} showName={false} />);
    expect(screen.queryByText("山間器物")).toBeNull();
  });
});
