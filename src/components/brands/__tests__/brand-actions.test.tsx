// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import zh from "../../../../messages/zh-TW.json";
import { trackExternalLinkClicked } from "@/lib/analytics";

vi.mock("@/lib/analytics", () => ({
  trackExternalLinkClicked: vi.fn(),
  trackBrandPageShared: vi.fn(),
}));

vi.mock("next/image", () => ({
  default: ({ alt = "", src }: { alt?: string; src: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt} src={typeof src === "string" ? src : ""} />
  ),
}));

import { BrandActions } from "../brand-actions";

const T = zh.brandDetail;

describe("BrandActions visit CTA", () => {
  beforeEach(() => {
    vi.mocked(trackExternalLinkClicked).mockClear();
  });

  // BD-03: the CTA used to log every channel as `website`, so a Shopee or
  // Pinkoi route-out was indistinguishable from a click to the brand's site.
  it("records the channel it routes to as the link type", () => {
    render(
      <NextIntlClientProvider locale="zh-TW" messages={zh}>
        <BrandActions
          websiteUrl="https://shopee.tw/harbor"
          visitKind="shopee"
          brandSlug="harbor-form"
          brandName="Harbor Form"
        />
      </NextIntlClientProvider>,
    );

    fireEvent.click(
      screen.getByRole("link", { name: T.actions.visitShopee }),
    );

    expect(trackExternalLinkClicked).toHaveBeenCalledTimes(1);
    expect(trackExternalLinkClicked).toHaveBeenCalledWith(
      "harbor-form",
      "shopee",
      expect.any(String),
      "detail_page",
      undefined,
    );
  });

  it("records an official-site CTA as website", () => {
    render(
      <NextIntlClientProvider locale="zh-TW" messages={zh}>
        <BrandActions
          websiteUrl="https://harbor.example"
          brandSlug="harbor-form"
          brandName="Harbor Form"
        />
      </NextIntlClientProvider>,
    );

    fireEvent.click(screen.getByRole("link"));

    expect(vi.mocked(trackExternalLinkClicked).mock.calls[0]?.[1]).toBe(
      "website",
    );
  });
});
