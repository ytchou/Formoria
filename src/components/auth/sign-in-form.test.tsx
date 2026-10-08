// @vitest-environment jsdom
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import zh from "../../../messages/zh-TW.json";

vi.mock("@/app/auth/actions", () => ({
  signIn: vi.fn(async () => ({})),
  signInWithGoogle: vi.fn(async () => undefined),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/auth/sign-in",
  Link: ({
    href,
    prefetch: _prefetch,
    children,
    ...rest
  }: {
    href: string;
    prefetch?: boolean;
    children: ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { SignInForm } = await import("./sign-in-form");

function renderForm(showOptionalAuthMethods: boolean) {
  const { container } = render(
    <NextIntlClientProvider locale="zh-TW" messages={zh}>
      <SignInForm showOptionalAuthMethods={showOptionalAuthMethods} />
    </NextIntlClientProvider>,
  );
  return container;
}

// SP2-27: staging hides Google, password reset and sign-up. The copy must not
// promise a method the page does not offer.
describe("SignInForm", () => {
  it("names Google only when the Google button is shown", () => {
    renderForm(true);

    expect(screen.getByText(zh.auth.signIn.subheading)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: zh.auth.signInWithGoogle }),
    ).toBeInTheDocument();
  });

  it("uses email-only copy when optional methods are hidden", () => {
    const container = renderForm(false);

    expect(
      screen.getByText(zh.auth.signIn.subheadingEmailOnly),
    ).toBeInTheDocument();
    expect(container.textContent).not.toContain("Google");
    expect(
      screen.queryByRole("link", { name: zh.auth.signIn.forgotPassword }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: zh.auth.signIn.signUpLink }),
    ).not.toBeInTheDocument();
  });
});
