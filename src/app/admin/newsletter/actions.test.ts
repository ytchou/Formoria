import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdminAction: vi.fn(),
  createServiceClient: vi.fn(() => ({ client: true })),
  resend: vi.fn(),
  unsubscribe: vi.fn(),
  log: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth/require-admin", () => ({ requireAdminAction: mocks.requireAdminAction }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: mocks.createServiceClient }));
vi.mock("@/lib/services/newsletter", () => ({
  resendNewsletterConfirmation: mocks.resend,
  adminUnsubscribeNewsletterSubscriber: mocks.unsubscribe,
}));
vi.mock("@/lib/services/admin-audit", () => ({ logAdminAction: mocks.log }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import {
  resendNewsletterConfirmationAction,
  unsubscribeNewsletterSubscriberAction,
} from "./actions";

describe("newsletter admin actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminAction.mockResolvedValue({
      user: { id: "admin-1", email: "admin@example.com" },
    });
  });

  it("resends confirmation through the token-safe service", async () => {
    await expect(
      resendNewsletterConfirmationAction("550e8400-e29b-41d4-a716-446655440001"),
    ).resolves.toEqual({ resent: true });
    expect(mocks.resend).toHaveBeenCalledWith(
      { client: true },
      "550e8400-e29b-41d4-a716-446655440001",
    );
  });

  it("unsubscribes by ID and rejects malformed IDs", async () => {
    await expect(unsubscribeNewsletterSubscriberAction("not-an-id")).resolves.toEqual({
      error: "Invalid subscriber ID",
    });
    expect(mocks.unsubscribe).not.toHaveBeenCalled();

    await expect(
      unsubscribeNewsletterSubscriberAction("550e8400-e29b-41d4-a716-446655440001"),
    ).resolves.toEqual({ unsubscribed: true });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/newsletter");
  });
});
