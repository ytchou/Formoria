/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import zhMessages from "../../../messages/zh-TW.json";

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/brands/facesun",
  Link: () => null,
}));

vi.mock("@/app/actions/locale-preference", () => ({
  setLocalePreference: vi.fn(),
}));

vi.mock("@/lib/auth/use-user", () => ({
  useUser: () => ({ user: null, loading: false }),
}));

const { AccountMenu } = await import("./account-menu");

// DEV-2018: GSC reported 141 robots-blocked /auth/sign-in?next=<page> URLs,
// one per page the signed-out header link appeared on.
describe("AccountMenu signed out", () => {
  it("renders the sign-in link as nofollow", () => {
    render(
      <NextIntlClientProvider locale="zh-TW" messages={zhMessages}>
        <AccountMenu />
      </NextIntlClientProvider>,
    );
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toContain("/auth/sign-in");
    expect(link).toHaveAttribute("rel", "nofollow");
  });
});
