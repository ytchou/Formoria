import { render } from "@react-email/render";
import { Layout } from "@emails/components/layout";
import { EmailHeading } from "@emails/components/email-heading";
import { EmailText } from "@emails/components/email-text";
import { Button } from "@emails/components/button";
import { FROM_ADDRESS, SITE_URL } from "@emails/styles";
import type { EmailMessage } from "@emails/types";
import { escapeHtml } from "@emails/utils";

type Locale = "zh-TW" | "en";

type ClaimSubmittedEmailProps = {
  submitterEmail: string;
  brandName: string;
  claimUrl: string;
  siteUrl?: string;
  locale?: Locale;
};

export default function ClaimSubmittedEmail({
  brandName,
  claimUrl,
  locale = "zh-TW",
}: ClaimSubmittedEmailProps) {
  const escapedBrandName = escapeHtml(brandName);
  const escapedClaimUrl = escapeHtml(claimUrl);

  if (locale === "en") {
    return (
      <Layout lang="en"
        previewText={`Claim your brand page on Formoria - ${escapedBrandName}`}
      >
        <EmailHeading as="h2">
          Congratulations! Your brand has been approved.
        </EmailHeading>
        <EmailText>
          <strong dangerouslySetInnerHTML={{ __html: escapedBrandName }} /> is
          now listed on Formoria.
        </EmailText>
        <EmailText>
          As the brand owner, you can claim your brand page to manage and edit
          your information directly.
        </EmailText>
        <Button href={escapedClaimUrl}>Claim your brand</Button>
        <EmailText>
          This link expires in 7 days. If you did not submit this brand, you can
          safely ignore this email.
        </EmailText>
        <EmailText>
          Formoria — Taiwanese Brand Discovery &amp; Curation
        </EmailText>
      </Layout>
    );
  }

  return (
    <Layout previewText={`認領 Formoria 上的品牌頁面 - ${escapedBrandName}`}>
      <EmailHeading as="h2">恭喜！品牌已通過審核。</EmailHeading>
      <EmailText>
        <strong dangerouslySetInnerHTML={{ __html: escapedBrandName }} />{" "}
        現已刊登於 Formoria。
      </EmailText>
      <EmailText>
        品牌擁有者可以認領品牌頁面，直接管理和編輯品牌資訊。
      </EmailText>
      <Button href={escapedClaimUrl}>認領品牌</Button>
      <EmailText>
        此連結將在 7 天後失效。如果不是你提交的品牌，可安全忽略此郵件。
      </EmailText>
      <EmailText>Formoria — 台灣品牌探索與選物平台</EmailText>
    </Layout>
  );
}

export async function buildClaimEmail(
  props: ClaimSubmittedEmailProps,
): Promise<EmailMessage> {
  const locale = props.locale ?? "zh-TW";
  const brandName = escapeHtml(props.brandName);

  return {
    to: props.submitterEmail,
    from: FROM_ADDRESS,
    subject:
      locale === "en"
        ? `Claim your brand page for "${brandName}" — Formoria`
        : `認領「${brandName}」的品牌頁面 — Formoria`,
    html: await render(
      <ClaimSubmittedEmail {...props} siteUrl={props.siteUrl ?? SITE_URL} />,
    ),
  };
}
