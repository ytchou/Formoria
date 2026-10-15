// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EmptyState } from "@/components/ui/empty-state";

describe("EmptyState", () => {
  it("is a transparent block on the section rhythm, not a bordered card", () => {
    const { container } = render(<EmptyState title="Nothing yet" />);
    const block = container.firstElementChild as HTMLElement;

    // EL-13: the empty state used to be a bordered surface card, which read as
    // one more result tile. It now sits on the page ground.
    expect(block.className).toContain("py-section");
    expect(block.className).not.toMatch(/\bborder\b/);
    expect(block.className).not.toMatch(/\bbg-surface\b/);
  });

  it("sets the title at section size in ink, as a paragraph", () => {
    render(<EmptyState title="Nothing yet" />);
    const title = screen.getByText("Nothing yet");

    // A `<p>`, not a heading: callers sit under page h1s at varying depths, and
    // a fixed heading level here would skip levels on some of them.
    expect(title.tagName).toBe("P");
    expect(title.className).toContain("type-section");
    expect(title.className).toContain("text-ink");
    expect(title.className).not.toContain("text-ink-muted");
  });

  it("renders body and a single action when given", () => {
    render(
      <EmptyState title="Nothing yet" body="Try again later" action={<button type="button">Retry</button>} />,
    );

    expect(screen.getByText("Try again later").className).toContain("type-body-sm");
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });
});
