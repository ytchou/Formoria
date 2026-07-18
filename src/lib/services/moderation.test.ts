import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  saveModerationFlags,
  scanContent,
  type ContentViolation,
} from "./moderation";

type MockedSupabaseServerModule = typeof import("@/lib/supabase/server") & {
  createServerClient: ReturnType<typeof vi.fn>;
};

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: vi.fn(),
}));

describe("scanContent (flattened)", () => {
  it("returns empty violations for clean content", () => {
    const result = scanContent("Good Brand", {
      description: "優質台灣品牌，致力於永續經營。",
      website: "https://goodbrand.com.tw",
    });
    expect(result.violations).toEqual([]);
  });

  it("returns violation with field+rule+message for suspicious TLD", () => {
    const result = scanContent("Brand", { website: "https://spam.tk" });
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatchObject({
      field: "website",
      rule: "suspicious_tld",
    });
  });

  it("returns violation for excessive URLs", () => {
    const result = scanContent("Brand", {
      description:
        "Visit https://a.com https://b.com https://c.com https://d.com for more",
    });
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatchObject({
      field: "description",
      rule: "excessive_urls",
    });
  });

  it("returns violation for contact injection (phone)", () => {
    const result = scanContent("Brand", {
      description: "聯絡我們 0912-345-678",
    });
    expect(result.violations.length).toBeGreaterThanOrEqual(1);
    expect(result.violations[0].field).toBe("description");
    expect(result.violations[0].rule).toBe("contact_injection_phone");
  });

  it("returns violation for contact injection (email)", () => {
    const result = scanContent("Brand", {
      description: "Email us at test@example.com for info",
    });
    expect(
      result.violations.some((v) => v.rule === "contact_injection_email"),
    ).toBe(true);
  });

  it("returns violation for excessive emoji", () => {
    const result = scanContent("Brand", {
      description: "🌟✨💫🎉🎊🌸🌺🌻🌹🌷🌼 手工皂品牌",
    });
    expect(result.violations.some((v) => v.rule === "excessive_emoji")).toBe(
      true,
    );
  });

  it("returns violation for short CJK description", () => {
    const result = scanContent("Brand", { description: "好皂品" });
    expect(result.violations.some((v) => v.rule === "short_description")).toBe(
      true,
    );
  });

  it("returns violation for description identical to brand name", () => {
    const result = scanContent("臺灣手工皂", { description: "臺灣手工皂" });
    expect(
      result.violations.some((v) => v.rule === "identical_description"),
    ).toBe(true);
  });

  it("returns multiple violations when multiple rules trigger", () => {
    const result = scanContent("Brand", {
      description: "聯絡 0912-345-678",
      website: "https://bad.tk",
    });
    expect(result.violations.length).toBeGreaterThanOrEqual(2);
  });

  it("returns english spam violation", () => {
    const result = scanContent("Brand", { name: "Click here to buy now" });
    expect(result.violations.some((v) => v.rule === "english_spam")).toBe(true);
  });
});

describe("saveModerationFlags", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps violations to block-tier moderation rows with the requested status", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const { createServerClient } =
      (await import("@/lib/supabase/server")) as MockedSupabaseServerModule;
    vi.mocked(createServerClient).mockReturnValue({
      from: vi.fn().mockReturnValue({ insert }),
    } as unknown as SupabaseClient<Database>);
    const violations: ContentViolation[] = [
      {
        field: "website",
        rule: "suspicious_tld",
        userMessage: "Suspicious URL — .tk domains are not allowed",
      },
    ];

    await saveModerationFlags("brand-1", "user-1", violations, "reviewed");

    expect(insert).toHaveBeenCalledWith([
      {
        brand_id: "brand-1",
        user_id: "user-1",
        field_name: "website",
        flag_reason: "suspicious_tld",
        flagged_content: "Suspicious URL — .tk domains are not allowed",
        tier: "block",
        status: "reviewed",
      },
    ]);
  });
});
