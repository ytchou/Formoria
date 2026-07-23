// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import zh from "../../../../messages/zh-TW.json";

const mocks = vi.hoisted(() => ({
  submitChannelInfoAction: vi.fn(),
  signInHref: vi.fn(() => "/auth/sign-in?next=%2Fbrands%2Ftest-brand"),
  usePathname: vi.fn(() => "/brands/test-brand"),
  useUser: vi.fn(),
}));

vi.mock("@/app/[locale]/brands/[slug]/actions", () => ({
  submitChannelInfoAction: mocks.submitChannelInfoAction,
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

import { ProvideChannelInfoDialog } from "../provide-channel-info-dialog";

function renderDialog() {
  return render(
    <NextIntlClientProvider locale="zh-TW" messages={zh}>
      <ProvideChannelInfoDialog brandId="brand-1" brandSlug="test-brand" />
    </NextIntlClientProvider>,
  );
}

describe("ProvideChannelInfoDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useUser.mockReturnValue({ user: null, loading: false });
  });

  it("shows address only for offline channels and gates anonymous submissions behind sign-in", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole("button", { name: "提供販售資訊" }));

    expect(screen.getByRole("textbox", { name: "地址" })).toBeInTheDocument();
    await user.selectOptions(
      screen.getByRole("combobox", { name: "通路類型" }),
      "online",
    );
    expect(
      screen.queryByRole("textbox", { name: "地址" }),
    ).not.toBeInTheDocument();

    expect(screen.getByText("請先登入才能提供販售資訊")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "登入" })).toHaveAttribute(
      "href",
      "/auth/sign-in?next=%2Fbrands%2Ftest-brand",
    );
    expect(
      screen.queryByRole("button", { name: "送出" }),
    ).not.toBeInTheDocument();
  });
});
