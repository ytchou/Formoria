// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import zh from "../../../../messages/zh-TW.json";
import type { BrandChannel } from "@/lib/types";

const mocks = vi.hoisted(() => ({
  confirmChannelAction: vi.fn(),
  getChannelViewerStateAction: vi.fn(),
  ownerModerateChannelAction: vi.fn(),
  signInHref: vi.fn(() => "/auth/sign-in?next=%2Fbrands%2Ftest-brand"),
  usePathname: vi.fn(() => "/brands/test-brand"),
  useUser: vi.fn(),
}));

vi.mock("@/app/[locale]/brands/[slug]/actions", () => ({
  confirmChannelAction: mocks.confirmChannelAction,
  getChannelViewerStateAction: mocks.getChannelViewerStateAction,
  ownerModerateChannelAction: mocks.ownerModerateChannelAction,
}));

vi.mock("@/i18n/locale-preference", () => ({
  signInHref: mocks.signInHref,
}));

vi.mock("@/i18n/navigation", () => ({
  usePathname: mocks.usePathname,
}));

vi.mock("@/lib/auth/use-user", () => ({
  useUser: mocks.useUser,
}));

import { UnconfirmedChannelGrid } from "../unconfirmed-channel-grid";

function makeChannel(
  index: number,
  overrides: Partial<BrandChannel> = {},
): BrandChannel {
  return {
    id: `channel-${index}`,
    name: `測試通路 ${index}`,
    channelType: index % 2 === 0 ? "offline" : "online",
    categoryLabel: "選品店",
    regionLabel: "臺北市",
    address: null,
    url: null,
    ownerStatus: "none",
    source: "community",
    confirmationCount: 0,
    status: "unconfirmed",
    ...overrides,
  };
}

function renderGrid(channels: BrandChannel[]) {
  return render(
    <NextIntlClientProvider locale="zh-TW" messages={zh}>
      <UnconfirmedChannelGrid
        channels={channels}
        brandId="brand-1"
        brandSlug="test-brand"
      />
    </NextIntlClientProvider>,
  );
}

describe("UnconfirmedChannelGrid", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useUser.mockReturnValue({ user: { id: "user-1" }, loading: false });
    mocks.getChannelViewerStateAction.mockResolvedValue({
      isOwner: false,
      confirmedChannelIds: [],
    });
    mocks.confirmChannelAction.mockResolvedValue({ confirmationCount: 1 });
    mocks.ownerModerateChannelAction.mockResolvedValue({ success: true });
  });

  it("caps at 8 channels and offers a show-all toggle", async () => {
    const user = userEvent.setup();
    renderGrid(Array.from({ length: 10 }, (_, index) => makeChannel(index)));

    expect(screen.getAllByTestId("channel-card")).toHaveLength(8);
    const showAll = screen.getByRole("button", { name: "顯示全部 (2)" });
    expect(showAll).toHaveAttribute("aria-expanded", "false");

    await user.click(showAll);

    expect(screen.getAllByTestId("channel-card")).toHaveLength(10);
    expect(screen.getByRole("button", { name: "收合" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("shows an inline sign-in prompt when an anonymous viewer confirms a channel", async () => {
    mocks.useUser.mockReturnValue({ user: null, loading: false });
    const user = userEvent.setup();
    renderGrid([makeChannel(1)]);

    await user.click(screen.getByRole("button", { name: /我確認這裡有販售/ }));

    expect(screen.getByText("登入後即可確認")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "登入" })).toHaveAttribute(
      "href",
      "/auth/sign-in?next=%2Fbrands%2Ftest-brand",
    );
    expect(mocks.signInHref).toHaveBeenCalledWith(
      "/brands/test-brand",
      "zh-TW",
    );
  });

  it("optimistically confirms and reverts a channel when confirmation fails", async () => {
    mocks.confirmChannelAction
      .mockResolvedValueOnce({ confirmationCount: 1 })
      .mockRejectedValueOnce(new Error("request failed"));
    const user = userEvent.setup();
    renderGrid([makeChannel(1), makeChannel(2)]);

    const cards = screen.getAllByTestId("channel-card");
    await user.click(
      within(cards[0]).getByRole("button", { name: /我確認這裡有販售/ }),
    );
    expect(within(cards[0]).getByText("1 人確認")).toBeInTheDocument();
    expect(
      within(cards[0]).getByRole("button", { name: /已確認/ }),
    ).toBeDisabled();

    await user.click(
      within(cards[1]).getByRole("button", { name: /我確認這裡有販售/ }),
    );
    expect(within(cards[1]).getByText("1 人確認")).toBeInTheDocument();

    await waitFor(() => {
      expect(within(cards[1]).getByText("0 人確認")).toBeInTheDocument();
      expect(within(cards[1]).getByRole("alert")).toBeInTheDocument();
    });
  });

  it("renders an already-confirmed card as pressed and disabled", async () => {
    mocks.getChannelViewerStateAction.mockResolvedValue({
      isOwner: false,
      confirmedChannelIds: ["channel-1"],
    });
    renderGrid([makeChannel(1)]);

    await waitFor(() => {
      const confirmedButton = screen.getByRole("button", { name: /已確認/ });
      expect(confirmedButton).toHaveAttribute("aria-pressed", "true");
      expect(confirmedButton).toBeDisabled();
    });
  });

  it("shows owner moderation buttons instead of the community confirmation button", async () => {
    mocks.getChannelViewerStateAction.mockResolvedValue({
      isOwner: true,
      confirmedChannelIds: [],
    });
    renderGrid([makeChannel(1)]);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "確認販售" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "未販售" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /我確認這裡有販售/ }),
      ).not.toBeInTheDocument();
    });
  });
});
