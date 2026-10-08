// @vitest-environment jsdom
import type { ReactNode } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import zh from "../../../messages/zh-TW.json";

vi.mock("@/app/auth/actions", () => ({
  signUp: vi.fn(async () => ({})),
  signInWithGoogle: vi.fn(async () => undefined),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/auth/sign-up",
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

const { SignUpForm } = await import("./sign-up-form");

const MISMATCH = "兩次輸入的密碼不一致";
const EMAIL_INVALID = zh.auth.validation.emailInvalid;

function renderForm() {
  render(
    <NextIntlClientProvider locale="zh-TW" messages={zh}>
      <SignUpForm />
    </NextIntlClientProvider>,
  );
  return {
    user: userEvent.setup(),
    email: screen.getByLabelText("電子郵件"),
    password: screen.getByLabelText("密碼"),
    confirm: screen.getByLabelText("確認密碼"),
  };
}

describe("SignUpForm", () => {
  it("shows the password hint as persistent text, not a placeholder", () => {
    const { password, confirm } = renderForm();

    const hint = screen.getByText("至少 8 個字元");
    expect(hint).toBeVisible();
    expect(password).not.toHaveAttribute("placeholder");
    expect(password.getAttribute("aria-describedby")).toContain(hint.id);
    expect(confirm).not.toHaveAttribute("placeholder");
  });

  it("does not show a mismatch before the confirm field is blurred", async () => {
    const { user, password, confirm } = renderForm();

    await user.type(password, "password123");
    await user.type(confirm, "password124");

    expect(screen.queryByText(MISMATCH)).toBeNull();
    expect(confirm).not.toHaveAttribute("aria-invalid");
  });

  it("flags a mismatched confirm password on blur, then clears it once fixed", async () => {
    const { user, password, confirm } = renderForm();

    await user.type(password, "password123");
    await user.type(confirm, "password124");
    await user.tab();

    const error = screen.getByText(MISMATCH);
    expect(confirm).toHaveAttribute("aria-invalid", "true");
    expect(confirm.getAttribute("aria-describedby")).toContain(error.id);

    await user.clear(confirm);
    await user.type(confirm, "password123");

    expect(screen.queryByText(MISMATCH)).toBeNull();
    expect(confirm).not.toHaveAttribute("aria-invalid");
  });

  it("flags an invalid email on blur only", async () => {
    const { user, email } = renderForm();

    await user.type(email, "x@");
    expect(screen.queryByText(EMAIL_INVALID)).toBeNull();

    await user.tab();

    expect(screen.getByText(EMAIL_INVALID)).toBeInTheDocument();
    expect(email).toHaveAttribute("aria-invalid", "true");
  });

  it("labels the Google button for sign-up", () => {
    renderForm();

    expect(
      screen.getByRole("button", { name: "使用 Google 繼續" }),
    ).toBeInTheDocument();
  });

  it("links the terms line to the terms and privacy pages", () => {
    renderForm();

    // Scoped to the terms line: the marketing opt-in field renders its own
    // /privacy link elsewhere in the form.
    const termsLine = within(
      screen.getByText(/建立帳號即表示你同意/).closest("p")!,
    );
    expect(termsLine.getByRole("link", { name: "服務條款" })).toHaveAttribute(
      "href",
      "/terms",
    );
    expect(termsLine.getByRole("link", { name: "隱私權政策" })).toHaveAttribute(
      "href",
      "/privacy",
    );
  });
});
