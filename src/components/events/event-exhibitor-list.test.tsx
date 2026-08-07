// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import en from "../../../messages/en.json";
import type { CreativeExpoEntry } from "@/lib/services/events";

// The row has its own suite; stubbing it keeps this file about the one property
// that matters here — every entry stays in the DOM, only the window is visible.
vi.mock("./event-exhibitor-row", () => ({
  EventExhibitorRow: ({
    entry,
    hidden,
  }: {
    entry: CreativeExpoEntry;
    hidden?: boolean;
  }) => (
    <li data-testid="exhibitor-row" className={hidden ? "hidden" : undefined}>
      {entry.name}
    </li>
  ),
}));

import { EventExhibitorList } from "./event-exhibitor-list";

const PAGE_SIZE = 20;

const entries = Array.from({ length: 45 }, (_, index) => ({
  id: `exhibitor-${index}`,
  name: `Exhibitor ${index}`,
  nameEn: null,
  booth: `K1-${index}`,
  area: null,
  areaEn: null,
  zone: "K1",
  websiteUrl: null,
  brand: null,
})) as unknown as CreativeExpoEntry[];

describe("EventExhibitorList", () => {
  it("renders every entry and hides the rows outside the first page", () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <EventExhibitorList
          entries={entries}
          eventSlug="2026-taiwan-creative-expo"
          startIndex={0}
          endIndex={PAGE_SIZE}
        />
      </NextIntlClientProvider>,
    );

    const rows = screen.getAllByTestId("exhibitor-row");

    expect(rows).toHaveLength(entries.length);
    expect(
      rows.filter((row) => !row.classList.contains("hidden")),
    ).toHaveLength(PAGE_SIZE);
    expect(rows[0]).not.toHaveClass("hidden");
    expect(rows[PAGE_SIZE]).toHaveClass("hidden");
  });

  it("moves the visible window without dropping any row", () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <EventExhibitorList
          entries={entries}
          eventSlug="2026-taiwan-creative-expo"
          startIndex={40}
          endIndex={entries.length}
        />
      </NextIntlClientProvider>,
    );

    const rows = screen.getAllByTestId("exhibitor-row");

    expect(rows).toHaveLength(entries.length);
    expect(
      rows.filter((row) => !row.classList.contains("hidden")),
    ).toHaveLength(5);
    expect(rows[0]).toHaveClass("hidden");
  });
});
