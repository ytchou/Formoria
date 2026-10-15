// @vitest-environment jsdom
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import zhMessages from "../../../../messages/zh-TW.json";

vi.mock("@/i18n/navigation", () => ({
  Link: ({
    href,
    children,
    prefetch: _prefetch,
    ...rest
  }: {
    href: string;
    children: ReactNode;
    prefetch?: boolean;
  } & Omit<ComponentPropsWithoutRef<"a">, "href" | "children">) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { Footer } from "../footer";

function renderFooter() {
  return render(
    <NextIntlClientProvider locale="zh-TW" messages={zhMessages}>
      <Footer />
    </NextIntlClientProvider>,
  );
}

describe("Footer", () => {
  it("closes the page with the promise at display size, on ink", () => {
    renderFooter();
    const tagline = screen.getByText(
      (_, el) => el?.tagName === "P" && el.textContent === zhMessages.footer.tagline,
    );

    // EL-12: the promise is the footer's top row, not fine print in the left
    // column.
    expect(tagline.className).toContain("type-display");
    expect(tagline.className).toContain("text-on-ink");
    expect(tagline.className).not.toContain("type-body-sm");
  });

  it("keeps the wordmark and the non-seller disclosure", () => {
    renderFooter();

    expect(screen.getByText("Formoria").className).toContain("type-card-title");
    expect(screen.getByText(zhMessages.footer.disclosure).className).toContain(
      "text-on-ink-muted",
    );
  });
});
