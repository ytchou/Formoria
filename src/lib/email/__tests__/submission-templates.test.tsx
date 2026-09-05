import { describe, it, expect } from "vitest";
import { buildApprovalEmail } from "@emails/templates/submission-approved";
import { buildRejectionEmail } from "@emails/templates/submission-rejected";

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
    expect(email.html).toContain("台灣品牌探索與選物平台");
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
    expect(email.html).toContain("已通過審核");
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

  it("uses the English action-needed subject", async () => {
    const email = await buildRejectionEmail({
      submitterEmail: "test@example.com",
      brandName: "Test Brand",
      denialReason: "not_mit",
      reviewerNotes: null,
      locale: "en",
    });

    expect(email.subject).toBe(
      "[Action Needed] Your Formoria submission needs attention",
    );
  });

  it("uses the zh-TW revision subject with brand name", async () => {
    const email = await buildRejectionEmail({
      submitterEmail: "test@example.com",
      brandName: "測試品牌",
      denialReason: "not_mit",
      reviewerNotes: null,
      locale: "zh-TW",
    });

    expect(email.subject).toBe("Formoria：「測試品牌」的提交內容需要修改");
  });

  it("includes the denial reason label and appeal contact", async () => {
    const email = await buildRejectionEmail({
      submitterEmail: "test@example.com",
      brandName: "Test Brand",
      denialReason: "not_mit",
      reviewerNotes: null,
      locale: "en",
    });

    expect(email.html).toContain("Not a Taiwanese Brand");
    expect(email.html).toContain("ops@formoria.com");
  });

  it("includes per-reason actionable guidance", async () => {
    const email = await buildRejectionEmail({
      submitterEmail: "test@example.com",
      brandName: "Test Brand",
      denialReason: "insufficient_info",
      reviewerNotes: null,
      locale: "en",
    });

    expect(email.html).toContain("complete description");
    expect(email.html).toContain("product photos");
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

    expect(en.html).toContain("No Purchase Channel Found");
    expect(en.html).toContain("online store or marketplace");

    const zh = await buildRejectionEmail({
      submitterEmail: "test@example.com",
      brandName: "Test Brand",
      denialReason: "no_purchase_channel",
      reviewerNotes: null,
      locale: "zh-TW",
    });

    expect(zh.html).toContain("找不到購買管道");
    expect(zh.html).toContain("線上商店或平台");
  });

  it("renders zh-TW guidance for zh-TW locale", async () => {
    const email = await buildRejectionEmail({
      submitterEmail: "test@example.com",
      brandName: "測試品牌",
      denialReason: "insufficient_info",
      reviewerNotes: null,
      locale: "zh-TW",
    });

    expect(email.html).toContain("資訊不足");
    expect(email.html).toContain("完整描述");
    expect(email.html).toContain("產品照片");
  });
});
