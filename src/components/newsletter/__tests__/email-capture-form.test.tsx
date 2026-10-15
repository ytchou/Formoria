// @vitest-environment jsdom
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import zh from "../../../../messages/zh-TW.json";

// The server action is the network boundary of this form: it reads request
// headers and writes through the service layer, neither of which exists in
// jsdom. The test asserts it is never reached for a malformed address.
const subscribeToNewsletter = vi.fn(async () => ({}));
vi.mock("@/app/actions/newsletter", () => ({
  subscribeToNewsletter: (...args: unknown[]) =>
    (subscribeToNewsletter as (...a: unknown[]) => unknown)(...args),
}));

vi.mock("@/i18n/navigation", () => ({
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

const { EmailCaptureForm } = await import("../email-capture-form");

function renderForm() {
  const { container } = render(
    <NextIntlClientProvider locale="zh-TW" messages={zh}>
      <EmailCaptureForm />
    </NextIntlClientProvider>,
  );
  return {
    user: userEvent.setup(),
    form: container.querySelector("form") as HTMLFormElement,
    email: screen.getByLabelText(zh.newsletter.emailLabel),
  };
}

describe("EmailCaptureForm", () => {
  beforeEach(() => {
    subscribeToNewsletter.mockClear();
  });

  it("puts the labelled interest group before the email row", () => {
    const { email } = renderForm();

    const group = screen.getByRole("group", {
      name: zh.newsletter.interestsLabel,
    });
    expect(group.tagName).toBe("FIELDSET");
    expect(group.querySelector("legend")).toHaveTextContent(
      zh.newsletter.interestsLabel,
    );
    expect(
      group.compareDocumentPosition(email) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("turns off native validation so the browser bubble never shows", () => {
    const { form, email } = renderForm();

    expect(form).toHaveAttribute("novalidate");
    expect(email).toHaveAttribute("type", "email");
    expect(email).toBeRequired();
  });

  it("shows the zh-TW inline error for a malformed address without calling the server", async () => {
    const { user, email } = renderForm();

    await user.type(email, "bad@");
    await user.click(
      screen.getByRole("button", { name: zh.newsletter.subscribe }),
    );

    const error = screen.getByText(zh.newsletter.errors.invalidEmail);
    expect(error).toHaveAttribute("aria-live", "polite");
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(error.id).toBeTruthy();
    expect(email.getAttribute("aria-describedby")).toBe(error.id);
    expect(email).toHaveFocus();
    expect(subscribeToNewsletter).not.toHaveBeenCalled();
  });

  it("clears the inline error once the address is edited", async () => {
    const { user, email } = renderForm();

    await user.click(
      screen.getByRole("button", { name: zh.newsletter.subscribe }),
    );
    expect(screen.getByText(zh.newsletter.errors.invalidEmail)).toBeVisible();
    expect(subscribeToNewsletter).not.toHaveBeenCalled();

    await user.type(email, "a");

    expect(
      screen.queryByText(zh.newsletter.errors.invalidEmail),
    ).not.toBeInTheDocument();
    expect(email).not.toHaveAttribute("aria-invalid");
    expect(email).not.toHaveAttribute("aria-describedby");
  });

  it("renders a server error through the same announced slot", async () => {
    subscribeToNewsletter.mockResolvedValueOnce({ error: "rateLimited" });
    const { user, email } = renderForm();

    await user.type(email, "m.garcia@company.invalid");
    await user.click(
      screen.getByRole("button", { name: zh.newsletter.subscribe }),
    );

    const error = await screen.findByText(zh.newsletter.errors.rateLimited);
    expect(subscribeToNewsletter).toHaveBeenCalledTimes(1);
    expect(error).toHaveAttribute("aria-live", "polite");
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(email.getAttribute("aria-describedby")).toBe(error.id);
  });
});
