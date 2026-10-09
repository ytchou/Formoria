/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// A minimal Embla API: a rail that overflows its root, and an autoScroll
// plugin whose play/stop are spies. Listeners are kept so a test can fire the
// plugin's own `autoScroll:play` event, as mouseleave/focusout do in the
// real plugin.
const { listeners, autoScroll, emblaApi } = vi.hoisted(() => {
  const listeners = new Map<string, Set<() => void>>();
  const autoScroll = { play: vi.fn(), stop: vi.fn() };
  const emblaApi = {
    plugins: () => ({ autoScroll }),
    containerNode: () => ({ scrollWidth: 2000 }),
    rootNode: () => ({ clientWidth: 400 }),
    on: (event: string, handler: () => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(handler);
    },
    off: (event: string, handler: () => void) => {
      listeners.get(event)?.delete(handler);
    },
  };
  return { listeners, autoScroll, emblaApi };
});

vi.mock("embla-carousel-react", () => ({
  default: () => [vi.fn(), emblaApi],
}));

vi.mock("embla-carousel-auto-scroll", () => ({
  default: () => ({}),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/components/brands/brand-avatar", () => ({
  BrandAvatar: ({
    name,
    showName = true,
  }: {
    name: string;
    showName?: boolean;
  }) => (showName ? <span>{name}</span> : null),
}));

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const { default: BrandMarquee } = await import("../brand-marquee");

const brands = [
  { id: "1", name: "Brand A", href: "/brands/a", imageSrc: null },
  { id: "2", name: "Brand B", href: "/brands/b", imageSrc: null },
];

function stubReducedMotion(matches: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({
    matches,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }) as unknown as typeof window.matchMedia;
}

// The marquee syncs its layout on the first animation frame.
async function renderMarquee() {
  render(<BrandMarquee brands={brands} />);
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
}

describe("BrandMarquee", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listeners.clear();
    stubReducedMotion(false);
  });

  it("renders each brand name once, clamped to two lines", async () => {
    await renderMarquee();

    const name = screen.getByText("Brand A");
    expect(name).toHaveClass("line-clamp-2");
    expect(name.closest("a")).toHaveAttribute("href", "/brands/a");
  });

  it("renders a pause button while the rail scrolls", async () => {
    await renderMarquee();

    expect(
      screen.getByRole("button", { name: "pauseMarquee" }),
    ).toBeInTheDocument();
    expect(autoScroll.play).toHaveBeenCalled();
  });

  it("stops the rail and switches to the play label on pause", async () => {
    await renderMarquee();
    autoScroll.stop.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "pauseMarquee" }));

    expect(autoScroll.stop).toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "playMarquee" }),
    ).toBeInTheDocument();
  });

  it("resumes the rail when play is pressed", async () => {
    await renderMarquee();
    fireEvent.click(screen.getByRole("button", { name: "pauseMarquee" }));
    autoScroll.play.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "playMarquee" }));

    expect(autoScroll.play).toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "pauseMarquee" }),
    ).toBeInTheDocument();
  });

  it("keeps a user pause when the plugin resumes on its own", async () => {
    await renderMarquee();
    fireEvent.click(screen.getByRole("button", { name: "pauseMarquee" }));
    autoScroll.stop.mockClear();

    // The plugin emits autoScroll:play on mouseleave/focusout.
    await act(async () => {
      listeners.get("autoScroll:play")?.forEach((handler) => handler());
      await Promise.resolve();
    });

    expect(autoScroll.stop).toHaveBeenCalled();
  });

  it("renders no button when reduced motion is preferred", async () => {
    stubReducedMotion(true);
    await renderMarquee();

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(autoScroll.play).not.toHaveBeenCalled();
  });
});
