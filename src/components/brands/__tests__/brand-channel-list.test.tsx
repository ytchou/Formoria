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

import { BrandChannelList } from "../brand-channel-list";

function makeChannel(
  index: number,
  overrides: Partial<BrandChannel> = {},
): BrandChannel {
  return {
    id: `channel-${index}`,
    name: `測試通路 ${index}`,
    channelType: "offline",
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
    threshold?: number;
  } = {},
) {
  return render(
    <NextIntlClientProvider locale="zh-TW" messages={zh}>
      <BrandChannelList
        confirmed={options.confirmed ?? []}
        possible={options.possible ?? []}
        brandId="brand-1"
        brandSlug="test-brand"
        threshold={options.threshold ?? 3}
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

function chipConfirmName(channelName: string) {
  return `我確認${channelName}有販售`;
}

describe("BrandChannelList", () => {
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

  it("renders a flat chip list without group headings below four channels", () => {
    const { container } = renderList({ possible: makeChannels(3) });

    expect(container.querySelectorAll("[data-channel-chip]")).toHaveLength(3);
    expect(container.querySelectorAll("[data-channel-row]")).toHaveLength(0);
    expect(screen.queryByRole("heading", { level: 3 })).not.toBeInTheDocument();
  });

  it("renders group headings with the count inside the accessible name", () => {
    renderList({
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
        makeChannel(4, { name: "線上商城", channelType: "online" }),
      ],
    });

    expect(
      screen.getByRole("heading", { level: 3, name: "官方通路 (1)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 3, name: "實體通路 (2)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 3, name: "線上通路 (1)" }),
    ).toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: "顯示其餘 4 家" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("shows unconfirmed physical retailers as chips without a collapsed fold", () => {
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

    expect(container.querySelector("details")).not.toBeInTheDocument();
    expect(container.querySelectorAll("[data-channel-chip]")).toHaveLength(3);
    expect(
      screen.queryByText("3 個社群提供的通路待確認"),
    ).not.toBeInTheDocument();
  });

  it("shows a shared sign-in prompt below the chip group for anonymous viewers", async () => {
    mocks.useUser.mockReturnValue({ user: null, loading: false });
    const user = userEvent.setup();
    const { container } = renderList({ possible: makeChannels(4) });

    await user.click(
      screen.getByRole("button", { name: chipConfirmName("測試通路 1") }),
    );

    const status = container.querySelector("[data-channel-chip-status]");
    expect(status).not.toBeNull();
    expect(
      within(status as HTMLElement).getByText("登入後即可確認"),
    ).toBeInTheDocument();
    expect(within(status as HTMLElement).getByText("測試通路 1")).toBeInTheDocument();
    expect(
      within(status as HTMLElement).getByRole("link", { name: "登入" }),
    ).toHaveAttribute("href", "/auth/sign-in?next=%2Fbrands%2Ftest-brand");
    expect(mocks.signInHref).toHaveBeenCalledWith("/brands/test-brand", "zh-TW");
  });

  it("optimistically confirms and reverts a chip when confirmation fails", async () => {
    mocks.confirmChannelAction
      .mockResolvedValueOnce({ confirmationCount: 1 })
      .mockRejectedValueOnce(new Error("database_error"));
    const user = userEvent.setup();
    const { container } = renderList({ possible: makeChannels(4) });

    const firstChip = getChip(container, "測試通路 1");
    await user.click(
      within(firstChip).getByRole("button", {
        name: chipConfirmName("測試通路 1"),
      }),
    );
    expect(within(firstChip).getByText("1/3 人確認")).toBeInTheDocument();
    expect(
      within(firstChip).getByRole("button", {
        name: chipConfirmName("測試通路 1"),
      }),
    ).toBeDisabled();

    const secondChip = getChip(container, "測試通路 2");
    await user.click(
      within(secondChip).getByRole("button", {
        name: chipConfirmName("測試通路 2"),
      }),
    );

    await waitFor(() => {
      expect(within(secondChip).getByText("0/3 人確認")).toBeInTheDocument();
      const status = container.querySelector("[data-channel-chip-status]");
      expect(status?.textContent).toContain("測試通路 2");
      expect(status?.textContent).toContain("系統錯誤，請稍後再試");
    });
  });

  it("marks only the pending chip while the confirm round-trip is in flight", async () => {
    let settleConfirm: (result: { confirmationCount: number }) => void = () => {};
    mocks.confirmChannelAction.mockImplementation(
      () =>
        new Promise<{ confirmationCount: number }>((resolve) => {
          settleConfirm = resolve;
        }),
    );
    const user = userEvent.setup();
    const { container } = renderList({ possible: makeChannels(4) });

    const chip = getChip(container, "測試通路 1");
    expect(chip).not.toHaveAttribute("data-confirm-pending");

    await user.click(
      within(chip).getByRole("button", { name: chipConfirmName("測試通路 1") }),
    );

    // The optimistic count is already 1/3 here — the attribute is what separates
    // "queued" from "written".
    expect(within(chip).getByText("1/3 人確認")).toBeInTheDocument();
    expect(chip).toHaveAttribute("data-confirm-pending", "");
    expect(
      within(chip).getByRole("button", { name: chipConfirmName("測試通路 1") }),
    ).toHaveAttribute("aria-busy", "true");
    expect(getChip(container, "測試通路 2")).not.toHaveAttribute(
      "data-confirm-pending",
    );

    settleConfirm({ confirmationCount: 1 });

    await waitFor(() => {
      expect(chip).not.toHaveAttribute("data-confirm-pending");
    });
  });

  it("renders an already-confirmed chip as pressed and disabled", async () => {
    mocks.getChannelViewerStateAction.mockResolvedValue({
      isOwner: false,
      confirmedChannelIds: ["channel-1"],
    });
    const { container } = renderList({ possible: makeChannels(4) });

    await waitFor(() => {
      const confirmedButton = within(
        getChip(container, "測試通路 1"),
      ).getByRole("button", { name: chipConfirmName("測試通路 1") });
      expect(confirmedButton).toHaveAttribute("aria-pressed", "true");
      expect(confirmedButton).toBeDisabled();
    });
  });

  it("renders owner moderation rows instead of chips for the brand owner", async () => {
    mocks.getChannelViewerStateAction.mockResolvedValue({
      isOwner: true,
      confirmedChannelIds: [],
    });
    const { container } = renderList({ possible: makeChannels(4) });

    await waitFor(() => {
      expect(container.querySelectorAll("[data-channel-row]")).toHaveLength(4);
      expect(container.querySelectorAll("[data-channel-chip]")).toHaveLength(0);
      expect(screen.getAllByRole("button", { name: "確認販售" })).toHaveLength(4);
      expect(screen.getAllByRole("button", { name: "未販售" })).toHaveLength(4);
      expect(
        screen.queryByRole("button", { name: /我確認/ }),
      ).not.toBeInTheDocument();
    });
  });
});
