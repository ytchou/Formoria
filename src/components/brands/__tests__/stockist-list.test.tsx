// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import zh from "../../../../messages/zh-TW.json";
import { CHAIN_REGION_LABEL } from "@/lib/brands/stockist-display";
import type { Stockist } from "@/lib/types";

import { StockistList } from "../stockist-list";

function makeStockist(
  index: number,
  overrides: Partial<Stockist> = {},
): Stockist {
  return {
    id: `stockist-${index}`,
    name: `測試通路 ${index}`,
    regionLabel: "臺北市",
    address: null,
    url: null,
    ownerStatus: "none",
    source: "community",
    status: "unconfirmed",
    ...overrides,
  };
}

/** The grouped layout only kicks in at 4+ stockists, so chip cases need padding. */
function makeStockists(count: number, overrides: Partial<Stockist> = {}) {
  return Array.from({ length: count }, (_, index) =>
    makeStockist(index + 1, overrides),
  );
}

function renderList(
  options: {
    confirmed?: Stockist[];
    possible?: Stockist[];
  } = {},
) {
  return render(
    <NextIntlClientProvider locale="zh-TW" messages={zh}>
      <StockistList
        confirmed={options.confirmed ?? []}
        possible={options.possible ?? []}
      />
    </NextIntlClientProvider>,
  );
}

function getChip(container: HTMLElement, name: string): HTMLElement {
  const chip = Array.from(
    container.querySelectorAll<HTMLElement>("[data-stockist-chip]"),
  ).find((element) => element.textContent?.includes(name));
  if (!chip) throw new Error(`Chip not found: ${name}`);
  return chip;
}

describe("StockistList", () => {
  it("renders a flat chip list without group headings below four stockists", () => {
    const { container } = renderList({ possible: makeStockists(3) });

    expect(container.querySelectorAll("[data-stockist-chip]")).toHaveLength(3);
    expect(container.querySelectorAll("[data-stockist-row]")).toHaveLength(0);
    expect(screen.queryByRole("heading", { level: 3 })).not.toBeInTheDocument();
  });

  /**
   * The four `data-stockist-*` hooks are the ONLY contract between this
   * component and `e2e/tests/brand-detail.spec.ts`. `tsconfig` excludes `e2e/`,
   * so neither `tsc` nor `vitest` reads that spec: a renamed attribute breaks
   * it at runtime, in CI, with nothing failing here first. This test is the
   * unit-side anchor for the rename -- it fails loudly in the same suite that
   * the wave gate runs.
   */
  it("renders stockist rows with the renamed data attributes", () => {
    const { container } = renderList({
      // An evidence-backed entry with an address renders as a full row; the
      // three plain entries render as chips. Four entries in total is what
      // tips the layout into groups, so all four hooks appear at once.
      confirmed: [
        makeStockist(1, {
          name: "茶籽堂大稻埕門市",
          address: "臺北市大同區迪化街一段94號",
          source: "import",
          status: "confirmed",
          confirmedBy: "evidence",
          evidenceSource: "official_website",
        }),
      ],
      possible: makeStockists(3),
    });

    expect(container.querySelectorAll("[data-stockist-kind]")).toHaveLength(1);
    expect(
      container.querySelector('[data-stockist-kind="taipei"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-stockist-chip-group="taipei"]'),
    ).not.toBeNull();
    expect(container.querySelectorAll("[data-stockist-chip]")).toHaveLength(3);
    expect(container.querySelectorAll("[data-stockist-row]")).toHaveLength(1);

    // The pre-rename hooks must be gone, or the e2e spec would keep passing
    // against a stale attribute while the new one goes unasserted. Scanned by
    // SUBSTRING rather than by a prefix or by four literals: two of the real
    // pre-rename hooks were `data-brand-channel-list` (on the list root, which
    // is in this render tree) and `data-brand-channels-section`, and a
    // `data-channel` prefix scan reports neither. It also keeps the retired
    // token itself out of the file, where a repo-wide sweep would read it as a
    // missed rename.
    const staleAttributes = Array.from(container.querySelectorAll("*"))
      .flatMap((element) => Array.from(element.attributes))
      .map((attribute) => attribute.name)
      .filter((name) => name.includes("channel"));

    expect(staleAttributes).toEqual([]);
  });

  it("starts every region collapsed and allows multiple regions to stay open", async () => {
    const user = userEvent.setup();
    const { container } = renderList({
      confirmed: [
        makeStockist(1, {
          name: "官方門市",
          ownerStatus: "confirmed",
          source: "owner",
          status: "confirmed",
          confirmedBy: "owner",
        }),
      ],
      possible: [
        makeStockist(2, { name: "有地址門市", address: "台北市信義區" }),
        makeStockist(3, { name: "連鎖門市" }),
        // The second region is an overseas stockist. It used to be an online
        // stockist, which was the only other group a fixture could reach before
        // DEV-1513 removed that bucket.
        makeStockist(4, {
          name: "香港門市",
          regionLabel: "香港",
          country: "HK",
        }),
      ],
    });

    expect(
      screen.getByRole("heading", { level: 3, name: "臺北市 (3)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 3, name: "海外 (1)" }),
    ).toBeInTheDocument();

    const taipei = container.querySelector<HTMLDetailsElement>(
      '[data-stockist-kind="taipei"]',
    );
    const overseas = container.querySelector<HTMLDetailsElement>(
      '[data-stockist-kind="overseas"]',
    );
    expect(taipei).not.toHaveAttribute("open");
    expect(overseas).not.toHaveAttribute("open");

    await user.click(
      screen.getByRole("heading", { level: 3, name: "臺北市 (3)" }),
    );
    await user.click(
      screen.getByRole("heading", { level: 3, name: "海外 (1)" }),
    );

    expect(taipei).toHaveAttribute("open");
    expect(overseas).toHaveAttribute("open");
  });

  it("renders an evidence-backed stockist as a full row", () => {
    const address = "臺北市大同區迪化街一段94號";
    const { container } = renderList({
      confirmed: [
        makeStockist(1, {
          name: "茶籽堂大稻埕門市",
          address,
          source: "import",
          fetchedAt: "2026-08-11T00:00:00.000Z",
          status: "confirmed",
          confirmedBy: "evidence",
          evidenceSource: "official_website",
        }),
      ],
    });

    expect(container.querySelectorAll("[data-stockist-row]")).toHaveLength(1);
    expect(screen.getByRole("link", { name: address })).toHaveAttribute(
      "href",
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`,
    );
    expect(screen.queryByText(/讀取於/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /我確認/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/人確認/)).not.toBeInTheDocument();
  });

  // The chain sentinel is a marker the enrichment phase writes, not a place.
  // The chip guarded it and the row did not, so `content/stockists/crafts.csv`
  // shipped one published row that printed the marker where an address goes —
  // and with it a retired term, onto a live brand page, through a data path the
  // message-catalogue lock cannot see. Referenced by the exported constant so
  // the token itself stays out of this file.
  it("never prints the chain sentinel as a row location", () => {
    renderList({
      confirmed: [
        makeStockist(1, {
          name: "有情門",
          regionLabel: CHAIN_REGION_LABEL,
          address: null,
          source: "import",
          status: "confirmed",
          confirmedBy: "evidence",
          evidenceSource: "official_website",
        }),
      ],
    });

    expect(screen.queryByText(CHAIN_REGION_LABEL)).not.toBeInTheDocument();
  });

  // 來自官網 is a trust claim about WHERE the fact came from, so it may only
  // appear when the evidence really is the brand's own site.
  it("labels official-website evidence 來自官網 and other evidence 來源佐證", () => {
    renderList({
      confirmed: [
        makeStockist(1, {
          name: "官網列出的門市",
          source: "import",
          status: "confirmed",
          confirmedBy: "evidence",
          evidenceSource: "official_website",
        }),
        makeStockist(2, {
          name: "其他來源的門市",
          source: "enriched",
          status: "confirmed",
          confirmedBy: "evidence",
          evidenceSource: "other",
        }),
      ],
    });

    expect(screen.getByText("來自官網")).toBeInTheDocument();
    expect(screen.getByText("來源佐證")).toBeInTheDocument();
  });

  it("shows neither evidence label when the row has no evidence", () => {
    renderList({
      confirmed: [
        makeStockist(1, {
          name: "品牌自己確認的門市",
          ownerStatus: "confirmed",
          status: "confirmed",
          confirmedBy: "owner",
        }),
      ],
    });

    expect(screen.getByText("品牌確認")).toBeInTheDocument();
    expect(screen.queryByText("來自官網")).not.toBeInTheDocument();
    expect(screen.queryByText("來源佐證")).not.toBeInTheDocument();
  });

  // 14 rows in content/stockists/*.csv are offline with a url and no address.
  // Gating the outbound link on the old stockist type left them with no way
  // through.
  it("falls back to the outbound link when an offline row has no address", () => {
    renderList({
      confirmed: [
        makeStockist(1, {
          name: "穿山甲裝備門市",
          address: null,
          url: "https://pngl.com.tw/",
          source: "import",
          status: "confirmed",
          confirmedBy: "evidence",
          evidenceSource: "official_website",
        }),
      ],
    });

    expect(
      screen.getByRole("link", { name: /前往官方頁面/ }),
    ).toHaveAttribute("href", "https://pngl.com.tw/");
  });

  it("keeps the Maps link as the only way through when there is an address", () => {
    const address = "臺北市大同區迪化街一段94號";
    renderList({
      confirmed: [
        makeStockist(1, {
          name: "有地址的門市",
          address,
          url: "https://example.com/store",
          source: "import",
          status: "confirmed",
          confirmedBy: "evidence",
          evidenceSource: "official_website",
        }),
      ],
    });

    expect(screen.getByRole("link", { name: address })).toHaveAttribute(
      "href",
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`,
    );
    expect(
      screen.queryByRole("link", { name: /前往官方頁面/ }),
    ).not.toBeInTheDocument();
  });

  it("renders addressed and addressless physical retailers as one chip group", () => {
    const address = "台北市信義區信義路五段 7 號";
    const { container } = renderList({
      possible: [
        makeStockist(1, { name: "有地址門市", address }),
        ...makeStockists(4).slice(1),
      ],
    });

    expect(getChip(container, "有地址門市")).toBeInTheDocument();
    expect(container.querySelectorAll("[data-stockist-chip]")).toHaveLength(4);
    expect(container.querySelectorAll("[data-stockist-row]")).toHaveLength(0);
    expect(screen.getByRole("link", { name: "臺北市" })).toHaveAttribute(
      "href",
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`,
    );
  });

  it("caps a chip group at 6 and reveals the rest behind a toggle", async () => {
    const user = userEvent.setup();
    const { container } = renderList({ possible: makeStockists(10) });

    expect(container.querySelectorAll("[data-stockist-chip]")).toHaveLength(6);
    const showRest = screen.getByRole("button", { name: "顯示其餘 4 家" });
    expect(showRest).toHaveAttribute("aria-expanded", "false");

    await user.click(showRest);

    expect(container.querySelectorAll("[data-stockist-chip]")).toHaveLength(10);
    expect(
      screen.getByRole("button", { name: "顯示其餘 4 家" }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("keeps community chips inside the collapsed region without a second fold", () => {
    const { container } = renderList({
      confirmed: [
        makeStockist(1, {
          name: "官方門市",
          address: "台北市信義區",
          ownerStatus: "confirmed",
          source: "owner",
          status: "confirmed",
          confirmedBy: "owner",
        }),
      ],
      possible: makeStockists(3, { address: "台中市西區" }),
    });

    expect(container.querySelector("details")).not.toHaveAttribute("open");
    expect(container.querySelectorAll("[data-stockist-chip]")).toHaveLength(3);
    expect(
      screen.queryByRole("button", { name: /顯示其餘/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("3 個社群提供的通路待確認"),
    ).not.toBeInTheDocument();
  });
});
