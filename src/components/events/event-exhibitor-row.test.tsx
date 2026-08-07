// @vitest-environment jsdom
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import en from "../../../messages/en.json";
import type { CreativeExpoEntry } from "@/lib/services/events";

vi.mock("@/i18n/navigation", () => ({
  // `...rest` is load-bearing: a fixed destructure would silently drop the
  // stretched-overlay className this row depends on.
  Link: ({
    href,
    children,
    ...rest
  }: { href: string; children: ReactNode } & Omit<
    ComponentPropsWithoutRef<"a">,
    "href" | "children"
  >) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/analytics", () => ({
  trackBrandCardClicked: vi.fn(),
  trackExhibitorSiteClicked: vi.fn(),
}));

import {
  trackBrandCardClicked,
  trackExhibitorSiteClicked,
} from "@/lib/analytics";
import { EventExhibitorRow } from "./event-exhibitor-row";

function makeEntry(overrides: Partial<CreativeExpoEntry>): CreativeExpoEntry {
  return {
    id: "exhibitor-1",
    sourceKey: "creative-expo:1",
    name: "Studio Smoll",
    nameEn: "Studio Smoll",
    booth: "K1-002",
    area: "Cultural & Creative Brands",
    areaEn: "Cultural & Creative Brands",
    zone: "K1",
    websiteUrl: "https://example.com/studio",
    brand: null,
    ...overrides,
  } as CreativeExpoEntry;
}

// `heroImageUrl` stays null on purpose: the monogram branch keeps `next/image`
// (and the allowed-host list) out of a test about link structure.
function makeBrand(slug: string) {
  return {
    id: slug,
    slug,
    name: "Studio Smoll",
    category: "home",
    description: null,
    descriptionEn: null,
    blurb: null,
    blurbEn: "A listed brand blurb.",
    heroImageUrl: null,
    productPhotos: [],
  };
}

function renderRow(entry: CreativeExpoEntry, position = 0) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ul>
        <EventExhibitorRow
          entry={entry}
          eventSlug="2026-taiwan-creative-expo"
          position={position}
        />
      </ul>
    </NextIntlClientProvider>,
  );
}

describe("EventExhibitorRow", () => {
  beforeEach(() => {
    vi.mocked(trackBrandCardClicked).mockClear();
    vi.mocked(trackExhibitorSiteClicked).mockClear();
  });

  it("renders a listed row as two links with distinct targets", () => {
    renderRow(
      makeEntry({
        brand: makeBrand(
          "studio-smoll",
        ) as unknown as CreativeExpoEntry["brand"],
      }),
    );

    const hrefs = screen
      .getAllByRole("link")
      .map((link) => link.getAttribute("href"));

    expect(hrefs).toEqual([
      "/brands/studio-smoll",
      "https://example.com/studio",
    ]);
    expect(
      screen.queryByText(en.events.exhibitorNotListed),
    ).not.toBeInTheDocument();
  });

  it("renders an unlisted row as a single outbound link with the not-listed marker", () => {
    renderRow(makeEntry({}));

    const links = screen.getAllByRole("link");

    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "https://example.com/studio");
    expect(links[0]).toHaveAttribute("rel", "noopener noreferrer nofollow");
    expect(screen.getByText(en.events.exhibitorNotListed)).toBeInTheDocument();
  });

  it("reports the absolute list position, not the position within a page", () => {
    renderRow(
      makeEntry({
        brand: makeBrand(
          "studio-smoll",
        ) as unknown as CreativeExpoEntry["brand"],
      }),
      42,
    );

    fireEvent.click(screen.getByRole("link", { name: "Studio Smoll" }));

    expect(vi.mocked(trackBrandCardClicked)).toHaveBeenCalledWith(
      "studio-smoll",
      "home",
      42,
      "studio-smoll",
    );
  });

  it("reports an unlisted exhibitor's outbound click with a null brand slug", () => {
    renderRow(makeEntry({}));

    fireEvent.click(screen.getAllByRole("link")[0]!);

    expect(vi.mocked(trackExhibitorSiteClicked)).toHaveBeenCalledWith(
      "creative-expo:1",
      "2026-taiwan-creative-expo",
      "K1-002",
      null,
    );
  });

  it("renders no link at all when an unlisted exhibitor has no website", () => {
    renderRow(makeEntry({ websiteUrl: null }));

    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.getByText("Studio Smoll")).toBeInTheDocument();
  });
});
