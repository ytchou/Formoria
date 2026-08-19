// @vitest-environment jsdom
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import en from "../../../messages/en.json";
import { CARD_GRID_COLUMNS } from "@/components/ui/grid";
import type { EventBrandEntry } from "@/lib/services/events";

// The card is exercised by its own suite; stubbing it keeps this file about the
// one thing it asserts — that the lineup lays out through the SHARED grid
// primitive rather than a hand-written `grid-cols-*` triple.
vi.mock("@/components/brands/brand-card", () => ({
  BrandCard: ({ brand }: { brand: { name: string } }) => (
    <span data-testid="brand-card">{brand.name}</span>
  ),
}));

// jsdom has no IntersectionObserver, and the reveal is not what is under test.
vi.mock("@/hooks/use-in-view", () => ({
  useInView: () => ({ ref: { current: null }, inView: true }),
}));

vi.mock("@/components/analytics/view-item-list-tracker", () => ({
  ViewItemListTracker: () => null,
}));

vi.mock("@/hooks/use-saved-brands", () => ({
  SavedBrandsProvider: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
}));

import { EventBrandResultView } from "./event-brand-result-view";

function makeEntry(name: string): EventBrandEntry {
  return {
    booth: "A01",
    area: "Craft",
    areaEn: "Craft",
    note: null,
    noteEn: null,
    brand: {
      id: name,
      name,
      slug: name.toLowerCase(),
    },
  } as unknown as EventBrandEntry;
}

function renderView(entries: EventBrandEntry[]) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <EventBrandResultView
        entries={entries}
        eventSlug="creative-expo-2026"
        locale="en"
        expanded
        hiddenCount={0}
        onExpand={() => {}}
      />
    </NextIntlClientProvider>,
  );
}

describe("EventBrandResultView", () => {
  it("lays the exhibitor lineup out through the shared grid primitive", () => {
    // The formula lived verbatim in six files with four different gap values
    // before the primitive existed. Asserting the exact class string is what
    // stops this surface quietly forking its own copy again.
    renderView([makeEntry("Alpha"), makeEntry("Beta")]);

    const list = screen.getByRole("list");
    for (const column of CARD_GRID_COLUMNS.split(" ")) {
      expect(list.className).toContain(column);
    }
    // The gutter is a token, never a numeric step.
    expect(list.className).toContain("gap-gutter");
  });

  it("renders every exhibitor into the markup", () => {
    renderView([makeEntry("Alpha"), makeEntry("Beta"), makeEntry("Gamma")]);

    expect(screen.getAllByTestId("brand-card")).toHaveLength(3);
  });
});
