import { Hr, Text } from "@react-email/components";
import { EmailLink } from "@emails/components/email-link";
import {
  FONT_SIZE_META,
  FONT_SIZE_MICRO,
  FONT_STACK,
  INK,
  INK_MUTED,
  LINE_HEIGHT_META,
  LINE_HEIGHT_MICRO,
  RULE,
  SPACE_GUTTER,
  SPACE_SECTION,
} from "@emails/styles";

type FooterProps = {
  unsubscribeUrl?: string;
};

/**
 * Left-aligned, matching the masthead. v1 centred all three lines, which put
 * the unsubscribe link in the optical centre of the message — the one place a
 * reader's eye lands on the way down.
 */
export function Footer({ unsubscribeUrl }: FooterProps) {
  return (
    <>
      <Hr style={rule} />
      <Text style={tagline}>Formoria — 台灣品牌探索與選物平台</Text>
      <Text style={contact}>
        <EmailLink href="mailto:ops@formoria.com" tone="muted">
          ops@formoria.com
        </EmailLink>
      </Text>
      {unsubscribeUrl ? (
        <Text style={unsubscribe}>
          <EmailLink href={unsubscribeUrl} tone="muted">
            取消訂閱
          </EmailLink>{" "}
          / Unsubscribe
        </Text>
      ) : null}
    </>
  );
}

const rule = {
  border: "none",
  borderTop: `1px solid ${RULE}`,
  margin: `${SPACE_SECTION} 0 ${SPACE_GUTTER}`,
  width: "100%",
};

const tagline = {
  color: INK,
  fontFamily: FONT_STACK,
  fontSize: FONT_SIZE_META,
  lineHeight: LINE_HEIGHT_META,
  margin: "0 0 8px",
  textAlign: "left" as const,
};

const contact = {
  color: INK_MUTED,
  fontFamily: FONT_STACK,
  fontSize: FONT_SIZE_META,
  lineHeight: LINE_HEIGHT_META,
  margin: "0 0 8px",
  textAlign: "left" as const,
};

const unsubscribe = {
  color: INK_MUTED,
  fontFamily: FONT_STACK,
  fontSize: FONT_SIZE_MICRO,
  lineHeight: LINE_HEIGHT_MICRO,
  margin: "0",
  textAlign: "left" as const,
};
