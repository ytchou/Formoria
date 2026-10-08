import * as React from "react";
import { render } from "@react-email/render";
import { Button } from "@emails/components/button";
import { EmailLink } from "@emails/components/email-link";
import { EmailHeading } from "@emails/components/email-heading";
import { EmailText } from "@emails/components/email-text";
import { Layout } from "@emails/components/layout";
import { FROM_ADDRESS } from "@emails/styles";
import type { EmailMessage } from "@emails/types";
import { escapeHtml } from "@emails/utils";

type Locale = "zh-TW" | "en";

type ApprovalEmailProps = {
  submitterEmail: string;
  brandName: string;
  brandSlug: string;
  siteUrl: string;
  locale?: Locale;
};

type ApprovalTemplateProps = Omit<ApprovalEmailProps, "submitterEmail"> & {
  brandNameHtml: string;
  brandUrl: string;
  locale: Locale;
};

export default function SubmissionApprovedEmail({
  brandNameHtml,
  brandUrl,
  locale,
}: ApprovalTemplateProps) {
  // Most recipients recommended the brand rather than own it, so the copy
  // never says "your brand".
  if (locale === "en") {
    return (
      <Layout lang="en" previewText="The brand you recommended is now listed">
        <EmailHeading>The brand you recommended is now listed</EmailHeading>
        <EmailText>
          <strong dangerouslySetInnerHTML={{ __html: brandNameHtml }} /> is now
          in the Formoria brand directory.
        </EmailText>
        <EmailText>Here&apos;s the brand page:</EmailText>
        <EmailText>
          <EmailLink href={brandUrl}>{brandUrl}</EmailLink>
        </EmailText>
        <Button href={brandUrl}>View the brand page</Button>
        <EmailText>Thanks for the recommendation.</EmailText>
      </Layout>
    );
  }

  return (
    <Layout previewText="你推薦的品牌已經收錄">
      <EmailHeading>你推薦的品牌已經收錄</EmailHeading>
      <EmailText>
        <strong dangerouslySetInnerHTML={{ __html: brandNameHtml }} />{" "}
        已經收錄進 Formoria 的品牌目錄。
      </EmailText>
      <EmailText>品牌頁在這裡：</EmailText>
      <EmailText>
        <EmailLink href={brandUrl}>{brandUrl}</EmailLink>
      </EmailText>
      <Button href={brandUrl}>看品牌頁</Button>
      <EmailText>謝謝你的推薦。</EmailText>
    </Layout>
  );
}

export async function buildApprovalEmail(
  params: ApprovalEmailProps,
): Promise<EmailMessage> {
  const locale = params.locale ?? "zh-TW";
  const brandName = escapeHtml(params.brandName);
  const brandUrl = `${params.siteUrl}/brands/${params.brandSlug}`;
  const subject =
    locale === "en"
      ? `"${brandName}" is now listed on Formoria`
      : `「${brandName}」已收錄進 Formoria`;

  return {
    to: params.submitterEmail,
    from: FROM_ADDRESS,
    subject,
    html: await render(
      <SubmissionApprovedEmail
        brandName={params.brandName}
        brandNameHtml={brandName}
        brandSlug={params.brandSlug}
        brandUrl={brandUrl}
        locale={locale}
        siteUrl={params.siteUrl}
      />,
    ),
  };
}
