// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import zh from "../../../../messages/zh-TW.json";
import en from "../../../../messages/en.json";
import { CHAIN_REGION_LABEL } from "@/lib/brands/stockist-display";
import type { Stockist } from "@/lib/types";

import { StockistList, stockistDistrict } from "../stockist-list";

// Real catalogue, real ICU formatting, for the server section's subtitle.
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const messages = (await import("../../../../messages/zh-TW.json")).default;
  type TranslatorOptions = Parameters<typeof createTranslator>[0];

  return {
    getTranslations: async ({ namespace }: { namespace: string }) =>
      createTranslator({
        locale: "zh-TW",
        messages,
        namespace,
      } as TranslatorOptions),
  };
});

const { StockistsSection } = await import("../stockists-section");
const channels = zh.brandDetail.channels;

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

/** The grouped layout only kicks in at 4+ stockists. */
function makeStockists(count: number, overrides: Partial<Stockist> = {}) {
  return Array.from({ length: count }, (_, index) =>
    makeStockist(index + 1, overrides),
  );
}

function mapsHref(address: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

function renderList(
  options: {
    confirmed?: Stockist[];
    possible?: Stockist[];
    locale?: "zh-TW" | "en";
  } = {},
) {
  const locale = options.locale ?? "zh-TW";
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "en" ? en : zh}
    >
      <StockistList
        confirmed={options.confirmed ?? []}
        possible={options.possible ?? []}
      />
    </NextIntlClientProvider>,
  );
}

function entries(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll<HTMLElement>("[data-stockist-row]"),
  );
}

// An entry folds either by its own `hidden` or by a hidden region group.
function isFolded(entry: HTMLElement) {
  return entry.closest("[hidden]") !== null;
}

describe("StockistList", () => {
  it("renders a flat list without region subheads below four stockists", () => {
    const { container } = renderList({ possible: makeStockists(3) });

    expect(entries(container)).toHaveLength(3);
    expect(container.querySelectorAll("[data-stockist-kind]")).toHaveLength(0);
    expect(screen.queryByRole("heading", { level: 4 })).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  /**
   * The `data-stockist-*` hooks are the ONLY contract between this component
   * and `e2e/tests/brand-detail.spec.ts` (`data-stockist-list`,
   * `data-stockist-kind` on each region group, `data-stockist-row` on each
   * entry). `tsconfig` excludes `e2e/`, so neither `tsc` nor `vitest` reads
   * that spec: a renamed attribute breaks it at runtime, in CI, with nothing
   * failing here first. This test is the unit-side anchor for those hooks.
   */
  it("renders the data attributes the e2e spec selects on", () => {
    const { container } = renderList({ possible: makeStockists(4) });

    expect(container.querySelector("[data-stockist-list]")).not.toBeNull();
    expect(container.querySelectorAll("[data-stockist-kind]")).toHaveLength(1);
    expect(
      container.querySelector('[data-stockist-kind="taipei"]'),
    ).not.toBeNull();
    expect(entries(container)).toHaveLength(4);

    // Pre-rename hooks must stay gone. Scanned by SUBSTRING: a prefix scan
    // misses `data-brand-channel-list`, one of the real retired hooks, and
    // the substring keeps the retired token itself out of this file.
    const staleAttributes = Array.from(container.querySelectorAll("*"))
      .flatMap((element) => Array.from(element.attributes))
      .map((attribute) => attribute.name)
      .filter((name) => name.includes("channel"));

    expect(staleAttributes).toEqual([]);
  });

  it("renders region subheads as h4 with the count outside the heading", () => {
    const { container } = renderList({
      possible: [
        ...makeStockists(3),
        makeStockist(4, { name: "香港門市", regionLabel: "香港", country: "HK" }),
      ],
    });

    const taipeiHeading = screen.getByRole("heading", {
      level: 4,
      name: "台北市",
    });
    expect(
      screen.getByRole("heading", { level: 4, name: "海外" }),
    ).toBeInTheDocument();
    // The count is 黑體 metadata beside the heading, never inside it.
    expect(taipeiHeading).not.toHaveTextContent("3");
    const taipeiGroup = container.querySelector<HTMLElement>(
      '[data-stockist-kind="taipei"]',
    );
    expect(within(taipeiGroup as HTMLElement).getByText("3 家")).toBeVisible();
    expect(screen.queryByText(/\(\d+\)/)).not.toBeInTheDocument();
  });

  it("shows every entry open with no toggle at or below eight", () => {
    const { container } = renderList({ possible: makeStockists(8) });

    expect(entries(container).filter(isFolded)).toHaveLength(0);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  // Content answering "where can I buy this" ships in the server HTML even
  // when folded: the cap hides entries, it never drops them.
  it("keeps entries past eight in the markup behind one toggle", async () => {
    const user = userEvent.setup();
    const { container } = renderList({ possible: makeStockists(10) });

    expect(entries(container)).toHaveLength(10);
    expect(entries(container).filter((entry) => !isFolded(entry))).toHaveLength(
      8,
    );
    expect(entries(container).filter(isFolded)).toHaveLength(2);

    const showAll = screen.getByRole("button", { name: "看全部 10 家" });
    expect(showAll).toHaveAttribute("aria-expanded", "false");
    expect(showAll.querySelector("[data-chevron]")).toHaveAttribute(
      "data-chevron",
      "down",
    );

    await user.click(showAll);

    expect(entries(container).filter(isFolded)).toHaveLength(0);
    const collapse = screen.getByRole("button", { name: "收合" });
    expect(collapse).toHaveAttribute("aria-expanded", "true");
    expect(collapse.querySelector("[data-chevron]")).toHaveAttribute(
      "data-chevron",
      "up",
    );

    await user.click(collapse);
    expect(entries(container).filter(isFolded)).toHaveLength(2);
  });

  it("counts the cap across groups and hides a group wholly past it", () => {
    const { container } = renderList({
      possible: [
        ...makeStockists(9),
        makeStockist(10, { name: "新北門市", regionLabel: "新北市" }),
      ],
    });

    const newTaipei = container.querySelector('[data-stockist-kind="new_taipei"]');
    expect(newTaipei).toHaveAttribute("hidden");
    expect(
      container.querySelector('[data-stockist-kind="taipei"]'),
    ).not.toHaveAttribute("hidden");
    expect(entries(container).filter(isFolded)).toHaveLength(2);
    expect(
      screen.getByRole("button", { name: "看全部 10 家" }),
    ).toBeInTheDocument();
  });

  it("makes the whole entry the Maps link when there is an address", () => {
    const address = "臺北市大同區迪化街一段94號";
    renderList({
      confirmed: [
        makeStockist(1, {
          name: "茶籽堂大稻埕門市",
          address,
          url: "https://example.com/store",
          source: "import",
          fetchedAt: "2026-08-11T00:00:00.000Z",
          status: "confirmed",
          confirmedBy: "evidence",
          evidenceSource: "official_website",
        }),
      ],
    });

    const links = screen.getAllByRole("link");
    // Exactly one way through: the address wins over the outbound URL.
    expect(links).toHaveLength(1);
    const link = links[0] as HTMLElement;
    expect(link).toHaveAttribute("href", mapsHref(address));
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveTextContent("茶籽堂大稻埕門市");
    expect(link).toHaveTextContent("大同區");
    expect(link.className).toContain("min-h-11");
    expect(screen.queryByText(/讀取於/)).not.toBeInTheDocument();
  });

  // 14 rows in content/stockists/*.csv are offline with a url and no address.
  it("links an addressless entry to its own url", () => {
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
      screen.getByRole("link", { name: /穿山甲裝備門市/ }),
    ).toHaveAttribute("href", "https://pngl.com.tw/");
  });

  it("renders an entry with no destination as plain text", () => {
    const { container } = renderList({ possible: makeStockists(1) });

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(entries(container)[0]).toHaveTextContent("測試通路 1");
  });

  // The chain sentinel is a marker the enrichment phase writes, not a place.
  // A row once printed it where an address goes — and with it a retired term,
  // onto a live brand page, through a data path the message-catalogue lock
  // cannot see. Referenced by the exported constant so the token itself stays
  // out of this file.
  it("never prints the chain sentinel", () => {
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

    expect(screen.getByText("有情門")).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(CHAIN_REGION_LABEL))).toBeNull();
  });

  // 來自官網 is a trust claim about WHERE the fact came from, so it may only
  // appear when the evidence really is the brand's own site.
  it("labels confirmed entries with their provenance", () => {
    renderList({
      confirmed: [
        makeStockist(1, {
          name: "官網列出的門市",
          address: "台北市信義區松高路11號",
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
        makeStockist(3, {
          name: "品牌自己確認的門市",
          ownerStatus: "confirmed",
          status: "confirmed",
          confirmedBy: "owner",
        }),
      ],
    });

    expect(screen.getByText("信義區 · 來自官網")).toBeInTheDocument();
    expect(screen.getByText("臺北市 · 來源佐證")).toBeInTheDocument();
    expect(screen.getByText("臺北市 · 品牌確認")).toBeInTheDocument();
  });

  it("prints no provenance on an unconfirmed entry", () => {
    renderList({
      possible: [
        makeStockist(1, { name: "社群門市", address: "台北市信義區松高路11號" }),
      ],
    });

    expect(
      screen.getByText(`信義區 · ${channels.status.possible}`),
    ).toBeInTheDocument();
    for (const label of Object.values(channels.provenance)) {
      expect(screen.queryByText(new RegExp(label))).not.toBeInTheDocument();
    }
    for (const summary of Object.values(channels.provenanceSummary)) {
      expect(screen.queryByText(summary)).not.toBeInTheDocument();
    }
  });

  // One shared provenance across an all-confirmed list is printed ONCE, above
  // the list, instead of repeated on every row.
  it("prints one provenance summary when every entry is confirmed the same way", () => {
    const { container } = renderList({
      confirmed: makeStockists(3, {
        address: "台北市信義區松高路11號",
        source: "import",
        status: "confirmed",
        confirmedBy: "evidence",
        evidenceSource: "official_website",
      }),
    });

    expect(
      screen.getByText(channels.provenanceSummary.evidence),
    ).toBeInTheDocument();
    for (const entry of entries(container)) {
      expect(entry).not.toHaveTextContent(channels.provenance.evidence);
    }
    expect(screen.getAllByText("信義區")).toHaveLength(3);
  });

  it("keeps per-row provenance when any entry is unconfirmed", () => {
    renderList({
      confirmed: [
        makeStockist(1, {
          address: "台北市信義區松高路11號",
          status: "confirmed",
          confirmedBy: "evidence",
          evidenceSource: "official_website",
        }),
      ],
      possible: [makeStockist(2)],
    });

    expect(
      screen.queryByText(channels.provenanceSummary.evidence),
    ).not.toBeInTheDocument();
    expect(screen.getByText("信義區 · 來自官網")).toBeInTheDocument();
  });

  // Status is never carried by the marker's colour or shape alone.
  it("names the status in text: visible for possible, sr-only for confirmed", () => {
    const { container } = renderList({
      confirmed: [
        makeStockist(1, {
          status: "confirmed",
          confirmedBy: "owner",
          ownerStatus: "confirmed",
        }),
      ],
      possible: [makeStockist(2)],
    });

    const [confirmedRow, possibleRow] = entries(container);
    const confirmedStatus = within(confirmedRow as HTMLElement).getByText(
      channels.status.confirmed,
    );
    expect(confirmedStatus).toHaveClass("sr-only");
    expect(
      within(possibleRow as HTMLElement).getByText(
        `臺北市 · ${channels.status.possible}`,
      ),
    ).not.toHaveClass("sr-only");
    expect(
      within(possibleRow as HTMLElement).queryByText(channels.status.confirmed),
    ).toBeNull();
    // The confirmed marker is neutral: no status colour outside the palette.
    expect(container.innerHTML).not.toContain("verified-green");
    expect(
      (confirmedRow as HTMLElement).querySelector('[aria-hidden="true"]'),
    ).toHaveClass("bg-surface", "text-ink");
  });

  it("lays entries out up to three columns", () => {
    const { container } = renderList({ possible: makeStockists(2) });

    expect(container.querySelector("ul")).toHaveClass(
      "sm:grid-cols-2",
      "lg:grid-cols-3",
    );
  });

  // Language of parts: a Han-script name or district on an English page is
  // marked so a screen reader switches voice for it.
  it("marks Han-script names and districts zh-Hant-TW on English pages", () => {
    const { container } = renderList({
      locale: "en",
      possible: [
        makeStockist(1, { name: "茶籽堂", address: "台北市信義區松高路11號" }),
        makeStockist(2, { name: "Latin Store", regionLabel: "Tokyo" }),
      ],
    });

    const [hanRow, latinRow] = entries(container);
    expect(within(hanRow as HTMLElement).getByText("茶籽堂")).toHaveAttribute(
      "lang",
      "zh-Hant-TW",
    );
    expect(within(hanRow as HTMLElement).getByText("信義區")).toHaveAttribute(
      "lang",
      "zh-Hant-TW",
    );
    expect(
      (latinRow as HTMLElement).querySelector("[lang]"),
    ).toBeNull();
  });

  it("adds no lang attributes on zh pages", () => {
    const { container } = renderList({
      possible: [
        makeStockist(1, { name: "茶籽堂", address: "台北市信義區松高路11號" }),
      ],
    });

    expect(container.querySelector("[lang]")).toBeNull();
  });
});

describe("StockistsSection", () => {
  async function renderSection(confirmed: Stockist[], possible: Stockist[]) {
    const section = await StockistsSection({
      locale: "zh-TW",
      confirmed,
      possible,
      brandId: "brand-1",
      brandSlug: "brand-1",
    });
    return render(
      <NextIntlClientProvider locale="zh-TW" messages={zh}>
        {section}
      </NextIntlClientProvider>,
    );
  }

  // The subtitle says the places MAY carry the brand and are partly
  // community-supplied — false for an all-confirmed list.
  it("shows the subtitle only when there are possible entries", async () => {
    await renderSection([], [makeStockist(1)]);
    expect(screen.getByText(channels.subtitle)).toBeInTheDocument();
  });

  it("omits the subtitle when every entry is confirmed", async () => {
    await renderSection(
      [
        makeStockist(1, {
          status: "confirmed",
          confirmedBy: "owner",
          ownerStatus: "confirmed",
        }),
      ],
      [],
    );
    expect(screen.queryByText(channels.subtitle)).not.toBeInTheDocument();
  });
});

describe("stockistDistrict", () => {
  it.each([
    ["台北市信義區松高路11號", "信義區"],
    ["110臺北市大安區復興南路一段", "大安區"],
    ["110 臺北市 大安區 復興南路一段", "大安區"],
    ["新竹縣竹北市光明六路", "竹北市"],
    ["嘉義市東區民族路", "東區"],
    ["高雄市前鎮區中華五路", "前鎮區"],
    ["香港九龍彌敦道100號", "香港九龍彌敦道100號"],
  ])("reads the district out of %s", (address, district) => {
    expect(stockistDistrict(makeStockist(1, { address }))).toBe(district);
  });

  it("falls back to the region label, never the chain sentinel", () => {
    expect(stockistDistrict(makeStockist(1))).toBe("臺北市");
    expect(
      stockistDistrict(makeStockist(1, { regionLabel: CHAIN_REGION_LABEL })),
    ).toBeNull();
    expect(stockistDistrict(makeStockist(1, { regionLabel: null }))).toBeNull();
  });
});
