// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NewsletterSubscribersList } from "../newsletter-subscribers";

const resendNewsletterConfirmationAction = vi.hoisted(() => vi.fn());
const unsubscribeNewsletterSubscriberAction = vi.hoisted(() => vi.fn());
vi.mock("@/app/admin/newsletter/actions", () => ({
  resendNewsletterConfirmationAction,
  unsubscribeNewsletterSubscriberAction,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

describe("NewsletterSubscribersList", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders safe subscriber fields and status-specific actions", () => {
    render(<NewsletterSubscribersList subscribers={subscribers} />);

    expect(screen.getByText("pending@example.com")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resend confirmation" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Unsubscribe" })).toHaveLength(2);
    expect(screen.queryByText(/token/i)).not.toBeInTheDocument();
  });

  it("confirms an admin unsubscribe before applying it", async () => {
    unsubscribeNewsletterSubscriberAction.mockResolvedValue({ unsubscribed: true });
    const user = userEvent.setup();
    render(<NewsletterSubscribersList subscribers={subscribers} />);

    await user.click(screen.getAllByRole("button", { name: "Unsubscribe" })[0]);
    expect(screen.getByRole("heading", { name: "Unsubscribe this address?" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirm unsubscribe" }));

    expect(unsubscribeNewsletterSubscriberAction).toHaveBeenCalledWith("550e8400-e29b-41d4-a716-446655440001");
  });
});

const subscribers = [
  {
    id: "550e8400-e29b-41d4-a716-446655440001",
    email: "pending@example.com",
    name: "Pending Reader",
    interests: ["brand-stories"],
    locale: "en",
    subscribed_at: "2026-07-18T09:00:00Z",
    confirmed_at: null,
    unsubscribed_at: null,
    consent_source: "homepage_newsletter",
    consent_version: "2026-07-16",
    consent_recorded_at: "2026-07-18T09:00:00Z",
    status: "pending" as const,
  },
  {
    id: "550e8400-e29b-41d4-a716-446655440002",
    email: "active@example.com",
    name: null,
    interests: ["curated-picks"],
    locale: "zh-TW",
    subscribed_at: "2026-07-17T09:00:00Z",
    confirmed_at: "2026-07-17T09:05:00Z",
    unsubscribed_at: null,
    consent_source: "settings",
    consent_version: "2026-07-16",
    consent_recorded_at: "2026-07-17T09:00:00Z",
    status: "active" as const,
  },
];
