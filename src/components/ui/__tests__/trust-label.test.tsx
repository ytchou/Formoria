// @vitest-environment jsdom
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";

import enMessages from "../../../../messages/en.json";
import zhMessages from "../../../../messages/zh-TW.json";
import {
  TRUST_LABELS,
  TrustLabel,
  type TrustLabelKind,
} from "@/components/ui/trust-label";

function renderZh(children: ReactNode) {
  return render(
    <NextIntlClientProvider locale="zh-TW" messages={zhMessages}>
      {children}
    </NextIntlClientProvider>,
  );
}

describe("TrustLabel", () => {
  it("renders 選物 with its accessible text", () => {
    renderZh(<TrustLabel />);

    const label = screen.getByText(zhMessages.trustLabel.selected);

    // The label is the vocabulary D11 commits to publicly, so pin the string
    // itself — not just "whatever the catalogue happens to hold".
    expect(zhMessages.trustLabel.selected).toContain("選物");
    expect(enMessages.trustLabel.selected).toBe("Formoria Selected");

    // It is a static label, not a control: no link, no button, no focus stop.
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(label.closest("a")).toBeNull();
    expect(label.closest("button")).toBeNull();
    expect(label).not.toHaveAttribute("tabindex");
    expect(label).not.toHaveAttribute("href");
  });

  it("refuses an unknown label", () => {
    // 選物 is the only trust label that may render as a badge. 收錄品牌 is
    // vocabulary — every brand in the directory is 收錄, so a badge carries zero
    // information (D11) — and 品牌提供 is a credit line rendered elsewhere.
    expect(TRUST_LABELS).toEqual(["selected"]);

    // Type level: the union is closed, so a second name does not compile.
    // @ts-expect-error -- "listed" (收錄) must never become a TrustLabel kind.
    const rejected: TrustLabelKind = "listed";
    expect(TRUST_LABELS).not.toContain(rejected);

    // Runtime level: a kind smuggled past the compiler renders nothing rather
    // than falling back to 選物 or leaking a raw catalogue key.
    const { container } = renderZh(
      <TrustLabel kind={"listed" as unknown as TrustLabelKind} />,
    );

    expect(container.querySelector("[data-slot='trust-label']")).toBeNull();
    expect(screen.queryByText(zhMessages.trustLabel.selected)).toBeNull();
  });

  it("marks itself as the selected trust label for downstream assertions", () => {
    renderZh(<TrustLabel />);

    const label = screen.getByText(zhMessages.trustLabel.selected);

    expect(label).toHaveAttribute("data-slot", "trust-label");
    expect(label).toHaveAttribute("data-trust-label", "selected");
  });

  it("forwards className without losing its own treatment", () => {
    renderZh(<TrustLabel className="mt-2" />);

    const label = screen.getByText(zhMessages.trustLabel.selected);

    expect(label).toHaveClass("mt-2");
    expect(label).toHaveClass("border-rule");
  });
});
