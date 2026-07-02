import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: mocks.getUser } })),
}));

import { requireAdminAction, requireAdminPage } from "@/lib/auth/require-admin";

const asUser = (email: string | null) =>
  mocks.getUser.mockResolvedValue({
    data: { user: email ? { id: "u1", email } : null },
    error: null,
  });

describe("requireAdminAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("ADMIN_EMAILS", "admin@formoria.com");
  });

  it("returns user for an admin email", async () => {
    asUser("admin@formoria.com");
    expect(await requireAdminAction()).toMatchObject({ user: { email: "admin@formoria.com" } });
  });

  it("returns error for a non-admin", async () => {
    asUser("someone@example.com");
    expect(await requireAdminAction()).toMatchObject({ error: expect.any(String), code: "forbidden" });
  });

  it("returns error when unauthenticated", async () => {
    asUser(null);
    expect(await requireAdminAction()).toMatchObject({ error: expect.any(String), code: "unauthenticated" });
  });

  it("ignores viewer-mode: admin-area access gates on pure isAdmin (SPEC §Admin)", async () => {
    asUser("admin@formoria.com");
    expect(await requireAdminAction()).toHaveProperty("user");
  });
});

describe("requireAdminPage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("redirects non-admins to sign-in with nextPath", async () => {
    asUser("someone@example.com");
    await expect(requireAdminPage("/admin/claims")).rejects.toThrow(/REDIRECT:.*admin.*claims|REDIRECT:.*sign/);
  });

  it("returns the user for admins", async () => {
    asUser("admin@formoria.com");
    await expect(requireAdminPage("/admin/claims")).resolves.toMatchObject({ email: "admin@formoria.com" });
  });
});
