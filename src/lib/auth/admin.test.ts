import { describe, it, expect, afterEach } from "vitest";
import { isAdmin } from "./admin";

describe("isAdmin", () => {
  const originalEnv = process.env.ADMIN_EMAILS;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.ADMIN_EMAILS = originalEnv;
    } else {
      delete process.env.ADMIN_EMAILS;
    }
  });

  it("returns true for an admin email", () => {
    process.env.ADMIN_EMAILS = "admin@example.com,other@example.com";
    expect(isAdmin("admin@example.com")).toBe(true);
  });

  it("matches case-insensitively", () => {
    process.env.ADMIN_EMAILS = "Admin@Example.com";
    expect(isAdmin("admin@example.com")).toBe(true);
  });

  it("returns false for a non-admin email", () => {
    process.env.ADMIN_EMAILS = "admin@example.com";
    expect(isAdmin("user@example.com")).toBe(false);
  });

  it("returns false when ADMIN_EMAILS is not set", () => {
    delete process.env.ADMIN_EMAILS;
    expect(isAdmin("admin@example.com")).toBe(false);
  });

  it("returns false for empty string", () => {
    process.env.ADMIN_EMAILS = "admin@example.com";
    expect(isAdmin("")).toBe(false);
  });

  it("trims whitespace from ADMIN_EMAILS entries", () => {
    process.env.ADMIN_EMAILS = " admin@example.com , other@example.com ";
    expect(isAdmin("admin@example.com")).toBe(true);
    expect(isAdmin("other@example.com")).toBe(true);
  });

  it("returns false when ADMIN_EMAILS is empty string", () => {
    process.env.ADMIN_EMAILS = "";
    expect(isAdmin("admin@example.com")).toBe(false);
  });
});
