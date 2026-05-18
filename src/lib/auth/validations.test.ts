import { describe, it, expect } from "vitest";
import { signInSchema, signUpSchema, isRelativeUrl } from "./validations";

describe("signInSchema", () => {
  it("accepts valid email and password", () => {
    const result = signInSchema.safeParse({
      email: "user@example.com",
      password: "password123",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid email", () => {
    const result = signInSchema.safeParse({
      email: "not-an-email",
      password: "password123",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty password", () => {
    const result = signInSchema.safeParse({
      email: "user@example.com",
      password: "",
    });
    expect(result.success).toBe(false);
  });
});

describe("signUpSchema", () => {
  it("accepts valid sign-up data", () => {
    const result = signUpSchema.safeParse({
      email: "user@example.com",
      password: "password123",
      confirmPassword: "password123",
    });
    expect(result.success).toBe(true);
  });

  it("rejects mismatched passwords", () => {
    const result = signUpSchema.safeParse({
      email: "user@example.com",
      password: "password123",
      confirmPassword: "different",
    });
    expect(result.success).toBe(false);
  });

  it("rejects password shorter than 8 characters", () => {
    const result = signUpSchema.safeParse({
      email: "user@example.com",
      password: "12345",
      confirmPassword: "12345",
    });
    expect(result.success).toBe(false);
  });
});

describe("isRelativeUrl", () => {
  it("accepts relative paths", () => {
    expect(isRelativeUrl("/dashboard")).toBe(true);
    expect(isRelativeUrl("/admin/users")).toBe(true);
  });

  it("rejects absolute URLs", () => {
    expect(isRelativeUrl("https://evil.com")).toBe(false);
    expect(isRelativeUrl("http://evil.com")).toBe(false);
  });

  it("rejects protocol-relative URLs", () => {
    expect(isRelativeUrl("//evil.com")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isRelativeUrl("")).toBe(false);
  });

  it("rejects javascript: protocol", () => {
    expect(isRelativeUrl("javascript:alert(1)")).toBe(false);
  });
});
