import { describe, it, expect } from "vitest";
import { buildApprovalEmail } from "@emails/templates/submission-approved";
import { buildRejectionEmail } from "@emails/templates/submission-rejected";
import { DENIAL_REASONS } from "@/lib/types/submission";

describe("buildApprovalEmail", () => {
  it("returns EmailMessage with branded HTML", async () => {
    const email = await buildApprovalEmail({
      submitterEmail: "test@example.com",
      brandName: "Test Brand",
      brandSlug: "test-brand",
      siteUrl: "https://formoria.com",
    });
    expect(email.to).toBe("test@example.com");
    expect(email.from).toContain("noreply@formoria.com");
    expect(email.subject).toContain("Test Brand");
    expect(email.html).toContain("Test Brand");
    expect(email.html).toContain("test-brand");
    expect(email.html).toContain("Formoria");
    expect(email.html).toContain("台灣好物選物平台");
    expect(email.html).toContain("#FAF7F2");
    expect(email.html).not.toContain("<script>");
    expect(email.html).not.toContain("undefined");
  });

  it("renders bilingual content for zh-TW locale", async () => {
    const email = await buildApprovalEmail({
      submitterEmail: "test@example.com",
      brandName: "Test Brand",
      brandSlug: "test-brand",
      siteUrl: "https://formoria.com",
      locale: "zh-TW",
    });
    expect(email.html).toContain("你推薦的品牌已經收錄");
    expect(email.html).not.toContain("刊登");
    expect(email.html).not.toContain("！");
  });

  it("does not assume the recipient owns the brand", async () => {
    const email = await buildApprovalEmail({
      submitterEmail: "test@example.com",
      brandName: "Test Brand",
      brandSlug: "test-brand",
      siteUrl: "https://formoria.com",
      locale: "en",
    });
    expect(email.subject).toBe('"Test Brand" is now listed on Formoria');
    expect(email.html).not.toMatch(/your brand/i);
    expect(email.html).not.toContain("!");
  });
});

describe("buildRejectionEmail", () => {
  it("returns EmailMessage with reviewer notes", async () => {
    const email = await buildRejectionEmail({
      submitterEmail: "test@example.com",
      brandName: "Test Brand",
      denialReason: "not_mit",
      reviewerNotes: "Not a Taiwan brand",
    });
    expect(email.to).toBe("test@example.com");
    expect(email.subject).toContain("Test Brand");
    expect(email.html).toContain("Not a Taiwan brand");
    expect(email.html).toContain("Formoria");
    expect(email.html).not.toContain("<script>");
  });

  it("uses the English recommendation subject", async () => {
    const email = await buildRejectionEmail({
      submitterEmail: "test@example.com",
      brandName: "Test Brand",
      denialReason: "not_mit",
      reviewerNotes: null,
      locale: "en",
    });

    expect(email.subject).toBe("About your recommendation: Test Brand");
  });

  it("uses the zh-TW recommendation subject with brand name", async () => {
    const email = await buildRejectionEmail({
      submitterEmail: "test@example.com",
      brandName: "測試品牌",
      denialReason: "not_mit",
      reviewerNotes: null,
      locale: "zh-TW",
    });

    expect(email.subject).toBe("關於你推薦的「測試品牌」");
  });

  it("includes the denial reason label and appeal contact", async () => {
    const email = await buildRejectionEmail({
      submitterEmail: "test@example.com",
      brandName: "Test Brand",
      denialReason: "not_mit",
      reviewerNotes: null,
      locale: "en",
    });

    expect(email.html).toContain("Taiwan connection not confirmed");
    expect(email.html).toContain("ops@formoria.com");
    // The guidance asks for a reply, and FROM_ADDRESS is noreply.
    expect(email.replyTo).toBe("ops@formoria.com");
  });

  it("includes per-reason actionable guidance", async () => {
    const email = await buildRejectionEmail({
      submitterEmail: "test@example.com",
      brandName: "Test Brand",
      denialReason: "insufficient_info",
      reviewerNotes: null,
      locale: "en",
    });

    expect(email.html).toContain("short description");
    expect(email.html).toContain("official link");
    // The recommend form has no photo field.
    expect(email.html).not.toMatch(/photo/i);
  });

  it("includes reviewer notes when provided", async () => {
    const email = await buildRejectionEmail({
      submitterEmail: "test@example.com",
      brandName: "Test Brand",
      denialReason: "other",
      reviewerNotes: "Please clarify factory location",
      locale: "en",
    });

    expect(email.html).toContain("Please clarify factory location");
  });

  it("rejection_email_renders_no_purchase_channel_copy", async () => {
    const en = await buildRejectionEmail({
      submitterEmail: "test@example.com",
      brandName: "Test Brand",
      denialReason: "no_purchase_channel",
      reviewerNotes: null,
      locale: "en",
    });

    expect(en.html).toContain("No place to buy found");
    expect(en.html).toContain("online store");

    const zh = await buildRejectionEmail({
      submitterEmail: "test@example.com",
      brandName: "Test Brand",
      denialReason: "no_purchase_channel",
      reviewerNotes: null,
      locale: "zh-TW",
    });

    expect(zh.html).toContain("找不到購買通路");
    expect(zh.html).toContain("線上商店");
  });

  it("renders zh-TW guidance for zh-TW locale", async () => {
    const email = await buildRejectionEmail({
      submitterEmail: "test@example.com",
      brandName: "測試品牌",
      denialReason: "insufficient_info",
      reviewerNotes: null,
      locale: "zh-TW",
    });

    expect(email.html).toContain("資料不夠完整");
    expect(email.html).toContain("品牌介紹和官方連結");
    expect(email.html).not.toContain("照片");
  });

  // CP2-30: the rejection reaches fans who recommended a brand. It must not
  // show admin jargon, deny Taiwan origin outright, ask for photos the form
  // can't take, or cite community guidelines that don't exist.
  it.each(DENIAL_REASONS.flatMap((reason) => [
    { reason, locale: "zh-TW" as const },
    { reason, locale: "en" as const },
  ]))("$reason $locale rejection avoids banned wording", async ({ reason, locale }) => {
    const email = await buildRejectionEmail({
      submitterEmail: "test@example.com",
      brandName: "Test Brand",
      denialReason: reason,
      reviewerNotes: null,
      locale,
    });
    const text = `${email.subject}\n${email.html}`;

    for (const banned of [
      "管理員",
      "非台灣品牌",
      "社群規範",
      "照片",
      "拒絕",
      "提交",
      "批准",
      "此",
      "Admin",
      "Denial",
      "Not a Taiwanese Brand",
      "community guidelines",
      "photo",
      "submission",
    ]) {
      expect(text, banned).not.toContain(banned);
    }
  });
});
