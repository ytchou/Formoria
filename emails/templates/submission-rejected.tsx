import * as React from "react";
import { Text } from "@react-email/components";
import { render } from "@react-email/render";
import { Button } from "@emails/components/button";
import { EmailLink } from "@emails/components/email-link";
import { EmailHeading } from "@emails/components/email-heading";
import { EmailText } from "@emails/components/email-text";
import { Layout } from "@emails/components/layout";
import {
  FONT_SIZE_BODY,
  FONT_STACK,
  FROM_ADDRESS,
  INK_SOFT,
  LINE_HEIGHT_BODY,
  RULE,
  SITE_URL,
  SPACE_GUTTER,
} from "@emails/styles";
import type { EmailMessage } from "@emails/types";
import { escapeHtml } from "@emails/utils";
import type { DenialReason } from "@/lib/types";

type Locale = "zh-TW" | "en";

/**
 * The guidance asks recipients to reply, and `FROM_ADDRESS` is a noreply
 * mailbox, so replies route to the same ops inbox the appeal line names.
 */
const REPLY_TO = "ops@formoria.com";

type RejectionEmailProps = {
  submitterEmail: string;
  brandName: string;
  denialReason: DenialReason;
  reviewerNotes: string | null;
  locale?: Locale;
};

type RejectionTemplateProps = Omit<
  RejectionEmailProps,
  "submitterEmail" | "reviewerNotes"
> & {
  brandNameHtml: string;
  locale: Locale;
  reviewerNotesHtml: string | null;
};

// Recipients are mostly fans who recommended a brand, not its owner, and the
// recommend form takes only a name, the official site, a short description and
// how they know the brand. Guidance asks only for what that form (or a reply to
// this email, see `replyTo` below) can carry.
const DENIAL_GUIDANCE: Record<DenialReason, { en: string; zh: string }> = {
  not_mit: {
    en: "We couldn't confirm that this brand was founded, designed, or made in Taiwan. If you have something that shows it, such as the About page on the brand's own site, reply to this email with it.",
    zh: "我們沒辦法確認這個品牌在台灣創立、設計或製造。如果有能說明的資料（例如品牌官網上的介紹），請回信附上。",
  },
  insufficient_info: {
    en: "We need a bit more. Add a short description and an official link, then recommend it again.",
    zh: "資料還不夠完整。請補上品牌介紹和官方連結，再推薦一次。",
  },
  duplicate: {
    en: "Someone has already recommended this brand. It's either in review or already listed. If you meant a different brand, reply to this email and tell us.",
    zh: "這個品牌已經有人推薦過，正在審核或已經收錄。如果你推薦的是另一個品牌，請回信告訴我們。",
  },
  policy_violation: {
    en: "This recommendation doesn't meet Formoria's listing rules. The FAQ explains them.",
    zh: "這次的推薦不符合 Formoria 的收錄規則，詳細說明請看常見問題。",
  },
  admin_reject: {
    en: "This recommendation wasn't approved.",
    zh: "這次的推薦沒有通過審核。",
  },
  no_purchase_channel: {
    en: "We couldn't find an online store that sells this brand's products. If you know one (the brand's own shop, Pinkoi, Shopee, or MyShip), reply to this email with the link.",
    zh: "我們找不到能買到這個品牌商品的線上商店。如果你知道哪裡買得到（品牌官網商店、Pinkoi、蝦皮或賣貨便），請回信附上連結。",
  },
  other: {
    en: "The reviewer's notes below explain why.",
    zh: "詳細原因寫在下方的審核意見。",
  },
};

const DENIAL_REASON_LABELS: Record<DenialReason, { en: string; zh: string }> = {
  not_mit: {
    en: "Taiwan connection not confirmed",
    zh: "無法確認和台灣的關聯",
  },
  insufficient_info: {
    en: "Not enough information",
    zh: "資料不夠完整",
  },
  duplicate: {
    en: "Already recommended",
    zh: "已經有人推薦過",
  },
  policy_violation: {
    en: "Doesn't meet the listing rules",
    zh: "不符合收錄規則",
  },
  admin_reject: {
    en: "Not approved",
    zh: "未通過審核",
  },
  no_purchase_channel: {
    en: "No place to buy found",
    zh: "找不到購買通路",
  },
  other: {
    en: "Other",
    zh: "其他",
  },
};

export default function SubmissionRejectedEmail({
  brandNameHtml,
  denialReason,
  locale,
  reviewerNotesHtml,
}: RejectionTemplateProps) {
  const copyKey = locale === "en" ? "en" : "zh";
  const denialReasonLabel = DENIAL_REASON_LABELS[denialReason][copyKey];
  const guidance = DENIAL_GUIDANCE[denialReason][copyKey];

  if (locale === "en") {
    return (
      <Layout lang="en" previewText="We can't list this brand yet">
        <EmailHeading>We can&apos;t list this brand yet</EmailHeading>
        <EmailText>
          Thanks for recommending{" "}
          <strong dangerouslySetInnerHTML={{ __html: brandNameHtml }} />.
        </EmailText>
        <EmailText>
          <strong>Reason:</strong> {denialReasonLabel}
        </EmailText>
        <EmailText>After review, we can&apos;t list this brand yet.</EmailText>
        <EmailText>{guidance}</EmailText>
        {reviewerNotesHtml ? (
          <ReviewerNotes
            label="Reviewer notes:"
            notesHtml={reviewerNotesHtml}
          />
        ) : null}
        <EmailText>
          If you think we got this wrong, email{" "}
          <EmailLink href={`mailto:${REPLY_TO}`}>{REPLY_TO}</EmailLink>.
        </EmailText>
        <EmailText>
          Once the details are complete, you&apos;re welcome to recommend it
          again.
        </EmailText>
        <Button href={SITE_URL}>Visit Formoria</Button>
      </Layout>
    );
  }

  return (
    <Layout previewText="這個品牌目前還不能收錄">
      <EmailHeading>這個品牌目前還不能收錄</EmailHeading>
      <EmailText>
        謝謝你推薦 <strong dangerouslySetInnerHTML={{ __html: brandNameHtml }} />
        。
      </EmailText>
      <EmailText>
        <strong>原因：</strong>
        {denialReasonLabel}
      </EmailText>
      <EmailText>審核後，這個品牌目前還不能收錄。</EmailText>
      <EmailText>{guidance}</EmailText>
      {reviewerNotesHtml ? (
        <ReviewerNotes label="審核意見：" notesHtml={reviewerNotesHtml} />
      ) : null}
      <EmailText>
        如果你覺得判斷有誤，請寫信到{" "}
        <EmailLink href={`mailto:${REPLY_TO}`}>{REPLY_TO}</EmailLink>。
      </EmailText>
      <EmailText>補齊資料後，可以再推薦一次。</EmailText>
      <Button href={SITE_URL}>前往 Formoria</Button>
    </Layout>
  );
}

function ReviewerNotes({
  label,
  notesHtml,
}: {
  label: string;
  notesHtml: string;
}) {
  return (
    <>
      <EmailText>
        <strong>{label}</strong>
      </EmailText>
      <Text
        style={blockquote}
        dangerouslySetInnerHTML={{ __html: notesHtml }}
      />
    </>
  );
}

/** A hairline in the left margin, not a grey slab: quoted reviewer copy. */
const blockquote = {
  borderLeft: `2px solid ${RULE}`,
  color: INK_SOFT,
  fontFamily: FONT_STACK,
  fontSize: FONT_SIZE_BODY,
  lineHeight: LINE_HEIGHT_BODY,
  margin: `0 0 ${SPACE_GUTTER}`,
  paddingLeft: SPACE_GUTTER,
};

export async function buildRejectionEmail(
  params: RejectionEmailProps,
): Promise<EmailMessage> {
  const locale = params.locale ?? "zh-TW";
  const brandName = escapeHtml(params.brandName);
  const reviewerNotes =
    params.reviewerNotes != null ? escapeHtml(params.reviewerNotes) : null;
  const subject =
    locale === "en"
      ? `About your recommendation: ${brandName}`
      : `關於你推薦的「${brandName}」`;

  return {
    to: params.submitterEmail,
    from: FROM_ADDRESS,
    subject,
    replyTo: REPLY_TO,
    html: await render(
      <SubmissionRejectedEmail
        brandName={params.brandName}
        brandNameHtml={brandName}
        denialReason={params.denialReason}
        locale={locale}
        reviewerNotesHtml={reviewerNotes}
      />,
    ),
  };
}
