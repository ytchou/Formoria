import { render } from "@react-email/render";
import { Img } from "@react-email/components";
import { Layout } from "@emails/components/layout";
import { EmailHeading } from "@emails/components/email-heading";
import { EmailText } from "@emails/components/email-text";
import { Button } from "@emails/components/button";
import {
  FONT_SIZE_META,
  FONT_STACK,
  FROM_ADDRESS,
  INK_MUTED,
  LINE_HEIGHT_META,
  RADIUS_SURFACE,
  RULE,
  SITE_URL,
  SPACE_GUTTER,
} from "@emails/styles";
import type { EmailMessage } from "@emails/types";
import { escapeHtml } from "@emails/utils";
import { buildShareCardUrl } from "@/lib/growth/share-assets";

type Locale = "zh-TW" | "en";

type ClaimApprovedEmailProps = {
  ownerEmail: string;
  brandName: string;
  brandSlug: string;
  siteUrl?: string;
  locale?: Locale;
};

export default function ClaimApprovedEmail({
  brandName,
  brandSlug,
  siteUrl = SITE_URL,
  locale = "zh-TW",
}: ClaimApprovedEmailProps) {
  const escapedBrandName = escapeHtml(brandName);
  // The owner dashboard was removed (DEV-1570), so the primary CTA points at
  // the brand's public page instead.
  const brandUrl = `${siteUrl}/brands/${escapeHtml(brandSlug)}`;
  const cardUrl = buildShareCardUrl(siteUrl, brandSlug);
  const downloadUrl = buildShareCardUrl(siteUrl, brandSlug, { download: true });

  if (locale === "en") {
    return (
      <Layout lang="en"
        previewText={`Your brand claim for ${escapedBrandName} has been approved`}
      >
        <EmailHeading as="h2">Your brand claim has been approved!</EmailHeading>
        <EmailText>
          Congratulations. Your claim for{" "}
          <strong dangerouslySetInnerHTML={{ __html: escapedBrandName }} /> has
          been approved.
        </EmailText>
        <EmailText>
          Your brand page on Formoria is now linked to your account.
        </EmailText>
        <Button href={brandUrl}>View your brand page</Button>
        <EmailText>Share the news — download your brand share card.</EmailText>
        <Img
          src={cardUrl}
          width="270"
          height="338"
          style={shareCard}
          alt={`${brandName} — Featured on Formoria share card`}
        />
        <Button href={downloadUrl}>Download share card</Button>
        <EmailText>
          Formoria — Taiwanese Brand Discovery &amp; Curation
        </EmailText>
      </Layout>
    );
  }

  return (
    <Layout previewText={`您的品牌認領申請「${escapedBrandName}」已通過審核`}>
      <EmailHeading as="h2">您的品牌認領申請已通過審核！</EmailHeading>
      <EmailText>
        恭喜您，
        <strong dangerouslySetInnerHTML={{ __html: escapedBrandName }} />{" "}
        的品牌認領申請已獲批准。
      </EmailText>
      <EmailText>您的品牌頁面已與您的帳號連結。</EmailText>
      <Button href={brandUrl}>查看品牌頁面</Button>
      <EmailText>分享這個好消息 — 下載品牌分享卡。</EmailText>
      <Img
        src={cardUrl}
        width="270"
        height="338"
        style={shareCard}
        alt={`${brandName} — Formoria 品牌分享卡`}
      />
      <Button href={downloadUrl}>下載分享卡</Button>
      <EmailText>Formoria — 台灣品牌探索與選物平台</EmailText>
    </Layout>
  );
}

export async function buildClaimApprovedEmail(
  props: ClaimApprovedEmailProps,
): Promise<EmailMessage> {
  const locale = props.locale ?? "zh-TW";
  const brandName = escapeHtml(props.brandName);

  return {
    to: props.ownerEmail,
    from: FROM_ADDRESS,
    subject:
      locale === "en"
        ? `Your brand claim for "${brandName}" has been approved — Formoria`
        : `您的品牌認領申請「${brandName}」已通過審核 — Formoria`,
    html: await render(
      <ClaimApprovedEmail {...props} siteUrl={props.siteUrl ?? SITE_URL} />,
    ),
  };
}

/**
 * The one image these emails send, and the one place a blocked image leaves a
 * hole. Most clients block images by default, so the alt text is typed as a
 * caption and the frame keeps its hairline whether or not the card loads —
 * the download button below it works either way.
 */
const shareCard = {
  border: `1px solid ${RULE}`,
  borderRadius: RADIUS_SURFACE,
  color: INK_MUTED,
  display: "block",
  fontFamily: FONT_STACK,
  fontSize: FONT_SIZE_META,
  lineHeight: LINE_HEIGHT_META,
  margin: `0 0 ${SPACE_GUTTER}`,
};
