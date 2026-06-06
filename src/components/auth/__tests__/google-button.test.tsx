// @vitest-environment jsdom
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "../../../../messages/en.json";
import { SignInForm } from "../sign-in-form";
import { SignUpForm } from "../sign-up-form";

vi.mock("next/navigation", () => ({
  useSearchParams: vi.fn(() => ({
    get: vi.fn(() => null),
  })),
}));

vi.mock("@/app/auth/actions", () => ({
  signIn: vi.fn(),
  signUp: vi.fn(),
  signInWithGoogle: vi.fn(),
}));

function renderWithIntl(ui: ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("SignInForm — Google button", () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders a "Continue with Google" button', () => {
    renderWithIntl(<SignInForm />);
    expect(
      screen.getByRole("button", { name: /continue with google/i }),
    ).toBeInTheDocument();
  });

  it("still renders the email/password sign-in submit", () => {
    renderWithIntl(<SignInForm />);
    expect(screen.getByRole("button", { name: /^sign in$/i })).toBeInTheDocument();
  });
});

describe("SignUpForm — Google button", () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders a "Continue with Google" button', () => {
    renderWithIntl(<SignUpForm />);
    expect(
      screen.getByRole("button", { name: /continue with google/i }),
    ).toBeInTheDocument();
  });

  it("still renders the email/password sign-up submit", () => {
    renderWithIntl(<SignUpForm />);
    expect(
      screen.getByRole("button", { name: /^create account$/i }),
    ).toBeInTheDocument();
  });
});
