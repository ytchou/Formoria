// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import zh from "../../../../messages/zh-TW.json";
import type { BrandChannel } from "@/lib/types";

const mocks = vi.hoisted(() => ({
  getChannelViewerStateAction: vi.fn(),
  ownerModerateChannelAction: vi.fn(),
  useUser: vi.fn(),
}));

vi.mock("@/app/[locale]/(site)/brands/[slug]/actions", () => ({
  getChannelViewerStateAction: mocks.getChannelViewerStateAction,
  ownerModerateChannelAction: mocks.ownerModerateChannelAction,
}));

vi.mock("@/lib/auth/use-user", () => ({
  useUser: mocks.useUser,
}));

import { BrandChannelList } from "../brand-channel-list";

function makeChannel(
  index: number,
  overrides: Partial<BrandChannel> = {},
): BrandChannel {
  return {
    id: `channel-${index}`,
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

/** The grouped layout only kicks in at 4+ channels, so chip cases need padding. */
function makeChannels(count: number, overrides: Partial<BrandChannel> = {}) {
  return Array.from({ length: count }, (_, index) =>
    makeChannel(index + 1, overrides),
  );
}

function renderList(
  options: {
    confirmed?: BrandChannel[];
    possible?: BrandChannel[];
  } = {},
) {
  return render(
    <NextIntlClientProvider locale="zh-TW" messages={zh}>
      <BrandChannelList
        confirmed={options.confirmed ?? []}
        possible={options.possible ?? []}
        brandId="brand-1"
        brandSlug="test-brand"
      />
    </NextIntlClientProvider>,
  );
}

function getChip(container: HTMLElement, name: string): HTMLElement {
  const chip = Array.from(
    container.querySelectorAll<HTMLElement>("[data-channel-chip]"),
  ).find((element) => element.textContent?.includes(name));
  if (!chip) throw new Error(`Chip not found: ${name}`);
  return chip;
}

describe("BrandChannelList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useUser.mockReturnValue({ user: { id: "user-1" }, loading: false });
    mocks.getChannelViewerStateAction.mockResolvedValue({ isOwner: false });
    mocks.ownerModerateChannelAction.mockResolvedValue({ success: true });
  });

  it("renders a flat chip list without group headings below four channels", () => {
    const { container } = renderList({ possible: makeChannels(3) });

    expect(container.querySelectorAll("[data-channel-chip]")).toHaveLength(3);
    expect(container.querySelectorAll("[data-channel-row]")).toHaveLength(0);
    expect(screen.queryByRole("heading", { level: 3 })).not.toBeInTheDocument();
  });

  it("starts every region collapsed and allows multiple regions to stay open", async () => {
    const user = userEvent.setup();
    const { container } = renderList({
      confirmed: [
        makeChannel(1, {
          name: "官方門市",
          ownerStatus: "confirmed",
          source: "owner",
          status: "confirmed",
          confirmedBy: "owner",
        }),
      ],
      possible: [
        makeChannel(2, { name: "有地址門市", address: "台北市信義區" }),
        makeChannel(3, { name: "連鎖門市" }),
        // The second region is an overseas stockist. It used to be an online
        // channel, which was the only other group a fixture could reach before
        // DEV-1513 removed that bucket.
        makeChannel(4, {
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
      '[data-channel-kind="taipei"]',
    );
    const overseas = container.querySelector<HTMLDetailsElement>(
      '[data-channel-kind="overseas"]',
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
        makeChannel(1, {
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

    expect(container.querySelectorAll("[data-channel-row]")).toHaveLength(1);
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

  // 來自官網 is a trust claim about WHERE the fact came from, so it may only
  // appear when the evidence really is the brand's own site.
  it("labels official-website evidence 來自官網 and other evidence 來源佐證", () => {
    renderList({
      confirmed: [
        makeChannel(1, {
          name: "官網列出的門市",
          source: "import",
          status: "confirmed",
          confirmedBy: "evidence",
          evidenceSource: "official_website",
        }),
        makeChannel(2, {
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
        makeChannel(1, {
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
  // Gating the outbound link on the old channel type left them with no way
  // through.
  it("falls back to the outbound link when an offline row has no address", () => {
    renderList({
      confirmed: [
        makeChannel(1, {
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
        makeChannel(1, {
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
        makeChannel(1, { name: "有地址門市", address }),
        ...makeChannels(4).slice(1),
      ],
    });

    expect(getChip(container, "有地址門市")).toBeInTheDocument();
    expect(container.querySelectorAll("[data-channel-chip]")).toHaveLength(4);
    expect(container.querySelectorAll("[data-channel-row]")).toHaveLength(0);
    expect(screen.getByRole("link", { name: "臺北市" })).toHaveAttribute(
      "href",
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`,
    );
  });

  it("caps a chip group at 6 and reveals the rest behind a toggle", async () => {
    const user = userEvent.setup();
    const { container } = renderList({ possible: makeChannels(10) });

    expect(container.querySelectorAll("[data-channel-chip]")).toHaveLength(6);
    const showRest = screen.getByRole("button", { name: "顯示其餘 4 家" });
    expect(showRest).toHaveAttribute("aria-expanded", "false");

    await user.click(showRest);

    expect(container.querySelectorAll("[data-channel-chip]")).toHaveLength(10);
    expect(
      screen.getByRole("button", { name: "顯示其餘 4 家" }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("keeps community chips inside the collapsed region without a second fold", () => {
    const { container } = renderList({
      confirmed: [
        makeChannel(1, {
          name: "官方門市",
          address: "台北市信義區",
          ownerStatus: "confirmed",
          source: "owner",
          status: "confirmed",
          confirmedBy: "owner",
        }),
      ],
      possible: makeChannels(3, { address: "台中市西區" }),
    });

    expect(container.querySelector("details")).not.toHaveAttribute("open");
    expect(container.querySelectorAll("[data-channel-chip]")).toHaveLength(3);
    expect(
      screen.queryByRole("button", { name: /顯示其餘/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("3 個社群提供的通路待確認"),
    ).not.toBeInTheDocument();
  });

  it("renders owner moderation rows instead of chips for the brand owner", async () => {
    mocks.getChannelViewerStateAction.mockResolvedValue({ isOwner: true });
    const { container } = renderList({ possible: makeChannels(4) });

    await waitFor(() => {
      expect(container.querySelectorAll("[data-channel-row]")).toHaveLength(4);
      expect(container.querySelectorAll("[data-channel-chip]")).toHaveLength(0);
      expect(screen.getAllByRole("button", { name: "確認販售" })).toHaveLength(
        4,
      );
      expect(screen.getAllByRole("button", { name: "未販售" })).toHaveLength(4);
      expect(
        screen.queryByRole("button", { name: /我確認/ }),
      ).not.toBeInTheDocument();
    });
  });
});
