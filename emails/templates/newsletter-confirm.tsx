import { Section, Text } from "@react-email/components";
import { render } from "@react-email/render";
import {
  Button,
  EmailDivider,
  EmailHeading,
  EmailLink,
  EmailText,
  Layout,
} from "@emails/components/";
import {
  FONT_SIZE_META,
  FONT_STACK,
  FROM_ADDRESS,
  INK,
  INK_MUTED,
  LINE_HEIGHT_META,
  RADIUS_PILL,
  RADIUS_SURFACE,
  RULE,
  SITE_URL,
  SPACE_GUTTER,
  SURFACE,
} from "@emails/styles";
import type { EmailMessage } from "@emails/types";
import { listUnsubscribeHeaders } from "@emails/utils";

type NewsletterConfirmEmailProps = {
  to: string;
  confirmToken: string;
  unsubscribeToken: string;
  interests: string[];
  locale?: string;
};

const INTEREST_LABELS: Record<string, Record<string, string>> = {
  "zh-TW": {
    "brand-stories": "品牌故事",
    "new-brands": "新品牌",
    "curated-picks": "選物推薦",
    "mit-trends": "台灣製造趨勢",
  },
  en: {
    "brand-stories": "Brand Stories",
    "new-brands": "New Brands",
    "curated-picks": "Curated Picks",
    "mit-trends": "MIT Trends",
  },
};

const COPY = {
  "zh-TW": {
    preview: "確認您的 Formoria 訂閱",
    heading: "確認訂閱",
    body: "感謝您訂閱 Formoria 電子報。請確認訂閱，以接收台灣品牌故事、新品牌與精選趨勢。",
    interestsLabel: "您選擇的主題",
    button: "確認訂閱",
    fallbackLink: "若按鈕無法使用，請開啟此連結：",
    disclaimer: "若您沒有訂閱 Formoria 電子報，可使用頁尾連結取消訂閱。",
    subject: "確認您的 Formoria 訂閱 — Formoria",
  },
  en: {
    preview: "Confirm your Formoria subscription",
    heading: "Confirm your subscription",
    body: "Thank you for subscribing to Formoria. Confirm your subscription to receive Taiwanese brand stories, new discoveries, and curated trends.",
    interestsLabel: "Selected interests",
    button: "Confirm Subscription",
    fallbackLink: "If the button does not work, open this link:",
    disclaimer:
      "If you did not request this subscription, you can unsubscribe from the footer link.",
    subject: "Confirm your Formoria subscription — Formoria",
  },
} as const;

function confirmUrl(token: string) {
  return `${SITE_URL}/api/newsletter/confirm?token=${encodeURIComponent(token)}`;
}

function unsubscribeUrl(token: string) {
  return `${SITE_URL}/api/newsletter/unsubscribe?token=${encodeURIComponent(token)}`;
}

export function NewsletterConfirmEmail({
  confirmToken,
  unsubscribeToken,
  interests,
  locale = "zh-TW",
}: NewsletterConfirmEmailProps) {
  const lang = locale === "en" ? "en" : "zh-TW";
  const copy = COPY[lang];
  const labels = INTEREST_LABELS[lang];
  const confirmationUrl = confirmUrl(confirmToken);
  const unsubscribeLink = unsubscribeUrl(unsubscribeToken);
  const selectedInterests = interests.map(
    (interest) => labels[interest] ?? interest,
  );

  return (
    <Layout
      lang={lang}
      previewText={copy.preview}
      unsubscribeUrl={unsubscribeLink}
    >
      <EmailHeading>{copy.heading}</EmailHeading>
      <EmailText>{copy.body}</EmailText>

      {selectedInterests.length > 0 ? (
        <Section style={interestsSection}>
          <Text style={interestIntro}>{copy.interestsLabel}</Text>
          {selectedInterests.map((interest) => (
            <Text key={interest} style={interestBadge}>
              {interest}
            </Text>
          ))}
        </Section>
      ) : null}

      <Button href={confirmationUrl}>{copy.button}</Button>

      <EmailDivider />
      <EmailText>{copy.fallbackLink}</EmailText>
      <EmailText>
        <EmailLink href={confirmationUrl}>{confirmationUrl}</EmailLink>
      </EmailText>
      <EmailText>{copy.disclaimer}</EmailText>
    </Layout>
  );
}

export async function buildNewsletterConfirmEmail(
  params: NewsletterConfirmEmailProps,
): Promise<EmailMessage> {
  const html = await render(<NewsletterConfirmEmail {...params} />);
  const lang = (params.locale === "en" ? "en" : "zh-TW") as keyof typeof COPY;

  return {
    to: params.to,
    from: FROM_ADDRESS,
    subject: COPY[lang].subject,
    html,
    replyTo: "ops@formoria.com",
    headers: listUnsubscribeHeaders(unsubscribeUrl(params.unsubscribeToken)),
  };
}

export default NewsletterConfirmEmail;

/**
 * An inset block on `surface`, the second material. v2 retired v1's "no
 * coloured section backgrounds" rule precisely so a group like this can be one
 * material rather than a white card floating on a warm page.
 */
const interestsSection = {
  backgroundColor: SURFACE,
  border: `1px solid ${RULE}`,
  borderRadius: RADIUS_SURFACE,
  margin: `0 0 ${SPACE_GUTTER}`,
  padding: SPACE_GUTTER,
};

const interestIntro = {
  color: INK_MUTED,
  fontFamily: FONT_STACK,
  fontSize: FONT_SIZE_META,
  lineHeight: LINE_HEIGHT_META,
  margin: "0 0 12px",
};

/** Chips keep the pill — the one stated exception to the 4px paper edge. */
const interestBadge = {
  border: `1px solid ${RULE}`,
  borderRadius: RADIUS_PILL,
  color: INK,
  display: "inline-block",
  fontFamily: FONT_STACK,
  fontSize: FONT_SIZE_META,
  lineHeight: LINE_HEIGHT_META,
  margin: "0 8px 8px 0",
  padding: "6px 12px",
};
