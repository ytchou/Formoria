// @vitest-environment jsdom
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import en from "../../../messages/en.json";
import zhTW from "../../../messages/zh-TW.json";
import type { CreativeExpoEntry } from "@/lib/services/events";

// The optimizer's loader has nothing to do in jsdom; the same plain-`img` stand-in
// `brand-card-mdx.test.tsx` uses keeps `src`/`alt` assertable. Framework boundary,
// not an internal module — scripts/check-test-boundaries.mjs only forbids the latter.
vi.mock("next/image", () => ({
  default: ({ alt = "", src }: { alt?: string; src: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt} src={typeof src === "string" ? src : ""} />
  ),
}));

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
    imageUrl: null,
    imageAltZh: null,
    imageAltEn: null,
    summaryZh: null,
    summaryEn: null,
    brand: null,
    ...overrides,
  } as CreativeExpoEntry;
}

// A roster-owned image has to survive `safeImageSrc`, so the host is a real
// Supabase storage host rather than example.com.
const ROSTER_IMAGE_URL =
  "https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/event-exhibitors/2026-taiwan-creative-expo/studio-smoll.jpg";

// `heroImageUrl` stays null on purpose: the link-structure tests below are about
// the row's anchors, and the monogram branch keeps the thumbnail out of them.
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

/** The zh ladder is a different code path, not a translation of the en one. */
function renderZhRow(entry: CreativeExpoEntry) {
  return render(
    <NextIntlClientProvider locale="zh-TW" messages={zhTW}>
      <ul>
        <EventExhibitorRow
          entry={entry}
          eventSlug="2026-taiwan-creative-expo"
          position={0}
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

  it("shows an unlisted exhibitor's own image and summary instead of the area label", () => {
    renderRow(
      makeEntry({
        imageUrl: ROSTER_IMAGE_URL,
        imageAltZh: "Studio Smoll 的手沖壺",
        imageAltEn: "A Studio Smoll pour-over kettle",
        summaryZh: "台南的手作陶器工作室。",
        summaryEn: "A Tainan studio throwing tableware by hand.",
      }),
    );

    const image = screen.getByRole("img");

    expect(image).toHaveAttribute("src", ROSTER_IMAGE_URL);
    // Roster images are the only description of an unlisted exhibitor we have,
    // so unlike a listed row's thumbnail they are not decorative.
    expect(image).toHaveAttribute("alt", "A Studio Smoll pour-over kettle");
    expect(
      screen.getByText("A Tainan studio throwing tableware by hand."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Cultural & Creative Brands"),
    ).not.toBeInTheDocument();
  });

  it("falls back to the monogram and the area label for an un-enriched exhibitor", () => {
    renderRow(makeEntry({}));

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("S")).toBeInTheDocument();
    expect(screen.getByText("Cultural & Creative Brands")).toBeInTheDocument();
  });

  it("never shows an English summary to a zh reader", () => {
    // Same rule as `BrandCard`: a zh page stays zh, so an exhibitor enriched in
    // English only keeps the area label rather than switching language mid-row.
    renderZhRow(
      makeEntry({
        summaryEn: "A Tainan studio throwing tableware by hand.",
      }),
    );

    expect(
      screen.queryByText("A Tainan studio throwing tableware by hand."),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Cultural & Creative Brands")).toBeInTheDocument();
  });

  it("keeps the not-listed marker on an exhibitor that has roster content", () => {
    // Enriched content is Formoria's own copy, not vetting: the exhibitor is
    // still absent from the directory and the row has to keep saying so.
    renderZhRow(
      makeEntry({
        imageUrl: ROSTER_IMAGE_URL,
        summaryZh: "台南的手作陶器工作室。",
      }),
    );

    expect(screen.getByText(zhTW.events.exhibitorNotListed)).toBeInTheDocument();
    expect(screen.getByText("台南的手作陶器工作室。")).toBeInTheDocument();
  });

  it("renders no link at all when an unlisted exhibitor has no website", () => {
    renderRow(makeEntry({ websiteUrl: null }));

    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.getByText("Studio Smoll")).toBeInTheDocument();
  });
});
