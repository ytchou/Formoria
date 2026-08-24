import { describe, expect, it } from "vitest";
import { buildNewsletterConfirmEmail } from "@emails/templates/newsletter-confirm";
import { buildApprovalEmail } from "@emails/templates/submission-approved";
import { buildRejectionEmail } from "@emails/templates/submission-rejected";
import type { EmailMessage } from "@emails/types";

type Locale = "zh-TW" | "en";

type SubjectCase = {
  name: string;
  locale: Locale;
  build: () => Promise<EmailMessage>;
  expected?: string;
  includesBrandName?: boolean;
  allowsPrefixException?: boolean;
};

const SITE_URL = "https://formoria.com";
const EMAIL = "owner@example.com";
const EN_BRAND = "Test Brand";
const ZH_BRAND = "測試品牌";

const approval = (locale: Locale, brandName: string) =>
  buildApprovalEmail({
    submitterEmail: EMAIL,
    brandName,
    brandSlug: "test-brand",
    siteUrl: SITE_URL,
    locale,
  });

const rejection = (locale: Locale, brandName: string) =>
  buildRejectionEmail({
    submitterEmail: EMAIL,
    brandName,
    denialReason: "not_mit",
    reviewerNotes: null,
    locale,
  });

const newsletterConfirm = (locale: Locale) =>
  buildNewsletterConfirmEmail({
    to: EMAIL,
    confirmToken: "newsletter-token",
    unsubscribeToken: "newsletter-unsubscribe-token",
    interests: ["brand-stories"],
    locale,
  });

const SUBJECT_CASES: SubjectCase[] = [
  {
    name: "submission-approved",
    locale: "zh-TW",
    build: () => approval("zh-TW", ZH_BRAND),
    expected: "品牌「測試品牌」已通過審核 — Formoria",
    includesBrandName: true,
  },
  {
    name: "submission-approved",
    locale: "en",
    build: () => approval("en", EN_BRAND),
    expected: 'Your brand "Test Brand" has been approved — Formoria',
    includesBrandName: true,
  },
  {
    name: "submission-rejected",
    locale: "zh-TW",
    build: () => rejection("zh-TW", ZH_BRAND),
    expected: "Formoria：「測試品牌」的提交內容需要修改",
    includesBrandName: true,
    allowsPrefixException: true,
  },
  {
    name: "submission-rejected",
    locale: "en",
    build: () => rejection("en", EN_BRAND),
    expected: "[Action Needed] Your Formoria submission needs attention",
    allowsPrefixException: true,
  },
  {
    name: "newsletter-confirm",
    locale: "zh-TW",
    build: () => newsletterConfirm("zh-TW"),
  },
  {
    name: "newsletter-confirm",
    locale: "en",
    build: () => newsletterConfirm("en"),
  },
];

describe("email subject line consistency", () => {
  it.each(SUBJECT_CASES)(
    "$name $locale subject follows Formoria formatting",
    async (testCase) => {
      const email = await testCase.build();

      if (testCase.expected) {
        expect(email.subject).toBe(testCase.expected);
      }

      if (!testCase.allowsPrefixException) {
        expect(email.subject).toMatch(/— Formoria$/);
      }

      expect(email.subject).not.toContain("- Formoria");
      expect(email.subject).not.toContain("/ Formoria");

      if (testCase.includesBrandName && testCase.locale === "zh-TW") {
        expect(email.subject).toContain(`「${ZH_BRAND}」`);
        expect(email.subject).not.toContain(`"${ZH_BRAND}"`);
      }

      if (testCase.includesBrandName && testCase.locale === "en") {
        expect(email.subject).toContain(`"${EN_BRAND}"`);
        expect(email.subject).not.toContain(`「${EN_BRAND}」`);
      }
    },
  );
});
