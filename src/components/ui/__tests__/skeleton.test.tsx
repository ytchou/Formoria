// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Skeleton } from "@/components/ui/skeleton";

describe("Skeleton", () => {
  it("is a static plate that fades in late, never a pulse", () => {
    const { container } = render(<Skeleton />);
    const plate = container.firstElementChild as HTMLElement;

    // EL-13: a pulse is motion that decorates a static state (DESIGN §7b).
    // The plate fades in once, after a delay, so a fast load never flashes it.
    expect(plate.className).not.toContain("animate-pulse");
    expect(plate.className).toContain("animate-skeleton-in");
    expect(plate.className).toContain("bg-surface-deep");
  });
});
