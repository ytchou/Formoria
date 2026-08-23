// @vitest-environment node
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { render } from "@react-email/render";
import * as tokens from "@emails/styles";
import { BrandCard } from "@emails/components/brand-card";
import { buildApprovalEmail } from "@emails/templates/submission-approved";
import { buildRejectionEmail } from "@emails/templates/submission-rejected";
import { buildClaimEmail } from "@emails/templates/claim-submitted";
import { buildClaimApprovedEmail } from "@emails/templates/claim-approved";
import { buildClaimRejectedEmail } from "@emails/templates/claim-rejected";
import { buildClaimEmailVerificationEmail } from "@emails/templates/claim-verified";
import { buildDeclarationRemovedEmail } from "@emails/templates/declaration-removed";
import { buildOwnershipRevokedEmail } from "@emails/templates/ownership-revoked";
import { buildNewsletterConfirmEmail } from "@emails/templates/newsletter-confirm";

/**
 * D17 — EMAIL IS A SANS-ONLY SURFACE WITH ONE COLOUR SOURCE.
 *
 * Two failures this file exists to catch, both of which shipped for months
 * because nothing rendered a template and looked at the hexes:
 *
 * 1. `@react-email/components` injects its OWN colours when a style is
 *    omitted — `Link` defaults to `#067df7` and `Hr` to a `1px solid #eaeaea`
 *    border-top shorthand. Eleven unstyled `<Link>`s were emitting a stock
 *    blue that appears in no Formoria palette, on live transactional mail.
 * 2. Mail clients strip `@font-face`, so a CJK webfont cannot ship here. The
 *    surface aligns with design system v2 through colour, spacing and layout,
 *    and never names 明體.
 */

const EMAIL_ROOT = join(process.cwd(), "emails");

/** Every hex a template is allowed to emit: the ones `emails/styles.ts` exports. */
const ALLOWED_HEXES = new Set(
  Object.values(tokens)
    .filter((value): value is string => typeof value === "string")
    .filter((value) => /^#[0-9a-fA-F]{6}$/.test(value))
    .map((value) => value.toLowerCase()),
);

/**
 * Hexes are read out of `style="…"` attributes only. Scanning the whole
 * document would trip over HTML entities — `&#847;` is the padding character
 * `Preview` repeats 150 times, and a naive `#[0-9a-f]{6}` walks straight into
 * it.
 */
function hexesInStyleAttributes(html: string): string[] {
  const found: string[] = [];
  for (const [, declarations] of html.matchAll(/style="([^"]*)"/g)) {
    for (const [hex] of declarations.matchAll(/#[0-9a-fA-F]{3,8}/g)) {
      found.push(hex.toLowerCase());
    }
  }
  return found;
}

const SITE = "https://formoria.com";

async function renderEveryTemplate(): Promise<Array<[string, string]>> {
  const built = await Promise.all([
    buildApprovalEmail({
      submitterEmail: "owner@formoria.com",
      brandName: "測試品牌",
      brandSlug: "test-brand",
      siteUrl: SITE,
    }),
    buildRejectionEmail({
      submitterEmail: "owner@formoria.com",
      brandName: "測試品牌",
      denialReason: "other",
      reviewerNotes: "需要補充產地資料。",
    }),
    buildClaimEmail({
      submitterEmail: "owner@formoria.com",
      brandName: "測試品牌",
      claimUrl: `${SITE}/claim/abc`,
    }),
    buildClaimApprovedEmail({
      ownerEmail: "owner@formoria.com",
      brandName: "測試品牌",
      brandSlug: "test-brand",
      siteUrl: SITE,
    }),
    buildClaimRejectedEmail({
      ownerEmail: "owner@formoria.com",
      brandName: "測試品牌",
      reviewerNotes: "資料不足。",
      siteUrl: SITE,
    }),
    buildClaimEmailVerificationEmail({
      recipientEmail: "owner@formoria.com",
      brandName: "測試品牌",
      verifyUrl: `${SITE}/claim/verify?token=abc`,
      siteUrl: SITE,
    }),
    buildDeclarationRemovedEmail({
      ownerEmail: "owner@formoria.com",
      brandName: "測試品牌",
      brandSlug: "test-brand",
      reviewerNotes: "產地證據不足。",
    }),
    buildOwnershipRevokedEmail({
      ownerEmail: "owner@formoria.com",
      brandName: "測試品牌",
      reason: "重複認領。",
    }),
    buildNewsletterConfirmEmail({
      to: "reader@formoria.com",
      confirmToken: "confirm-token",
      unsubscribeToken: "unsub-token",
      interests: ["brand-stories", "new-brands"],
    }),
  ]);

  const documents: Array<[string, string]> = built.map((message, index) => [
    `template-${index}`,
    message.html,
  ]);

  // `BrandCard` has no template consumer, so it renders directly or it is
  // never covered at all.
  documents.push([
    "BrandCard",
    await render(
      <BrandCard
        name="測試品牌"
        imageUrl="https://example.supabase.co/hero.jpg"
        blurb="一段品牌簡介。"
        ctaUrl={`${SITE}/brands/test-brand`}
      />,
    ),
  ]);

  return documents;
}

describe("email templates render the v2 palette", () => {
  it("emits no hex that emails/styles.ts does not export", async () => {
    const documents = await renderEveryTemplate();
    const offenders: string[] = [];

    for (const [name, html] of documents) {
      for (const hex of hexesInStyleAttributes(html)) {
        if (!ALLOWED_HEXES.has(hex)) offenders.push(`${name}: ${hex}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("carries the v2 ground, ink, rule and accent", () => {
    expect(tokens.GROUND).toBe("#FAF7F2");
    expect(tokens.SURFACE).toBe("#F1EAE0");
    expect(tokens.INK).toBe("#1A1815");
    expect(tokens.INK_SOFT).toBe("#4A443C");
    expect(tokens.INK_MUTED).toBe("#6F685F");
    expect(tokens.RULE).toBe("#DED5C8");
    expect(tokens.ACCENT).toBe("#2F4F63");
  });

  it("is pinned to globals.css, so a token fix reaches email too", () => {
    // `emails/styles.ts` is a SECOND COPY of the palette — email CSS is a
    // separate world and imports nothing from the stylesheet. A second copy is
    // how v1's palette forked four ways, so it is pinned rather than trusted.
    //
    // This already earned its keep once: `--ink-muted` shipped as `#7A736A`,
    // which measures 4.38:1 on ground — below the 4.5:1 floor the footer here
    // needs at 12–13px. Correcting it to `#6F685F` (5.14:1 on ground, 4.60:1
    // on surface) turned this assertion red until email followed.
    const css = readFileSync(
      join(process.cwd(), "src/app/globals.css"),
      "utf8",
    );
    const declared = (token: string) =>
      new RegExp(`--${token}:\\s*(#[0-9A-Fa-f]{6})`).exec(css)?.[1];

    expect(declared("ground")).toBe(tokens.GROUND);
    expect(declared("surface")).toBe(tokens.SURFACE);
    expect(declared("ink")).toBe(tokens.INK);
    expect(declared("ink-soft")).toBe(tokens.INK_SOFT);
    expect(declared("ink-muted")).toBe(tokens.INK_MUTED);
    expect(declared("rule")).toBe(tokens.RULE);
    expect(declared("accent")).toBe(tokens.ACCENT);
    // The label on an accent fill is the ground, matching `bg-accent
    // text-ground` on the site's own primary button.
    expect(tokens.ON_ACCENT).toBe(tokens.GROUND);
  });

  it("retires every rejected v1 colour across the surface", () => {
    const sources = ["styles.ts", "components", "templates"].map((entry) =>
      readdirText(join(EMAIL_ROOT, entry)),
    );

    for (const source of sources) {
      // kiln and the two v1 greens it displaced.
      expect(source).not.toMatch(/#(2F5D50|C4693B|C04A24)/i);
      // v1 paper / border / ink / caption, replaced by the v2 ramp above.
      expect(source).not.toMatch(/#(FDFCFA|E8E5E0|18181B|6B6B6B)/i);
      // Tailwind greys that leaked into two blockquotes and three link styles.
      expect(source).not.toMatch(/#(d1d5db|374151|2563eb)/i);
    }
  });
});

describe("email layout uses a sans system stack only (D17)", () => {
  it("names no serif family and loads no webfont", () => {
    const withoutSansSerif = tokens.FONT_STACK.replaceAll("sans-serif", "");

    expect(withoutSansSerif).not.toMatch(/serif/i);
    expect(withoutSansSerif).not.toMatch(/明體|宋體|Ming|Song|Noto Serif/i);
    expect(tokens.FONT_STACK.trim().endsWith("sans-serif")).toBe(true);
  });

  it("emits no @font-face, no font <link>, and no font-ming anywhere", async () => {
    const documents = await renderEveryTemplate();

    for (const [name, html] of documents) {
      expect(html, name).not.toContain("@font-face");
      expect(html, name).not.toContain("fonts.googleapis.com");
      expect(html, name).not.toContain("fonts.gstatic.com");
      expect(html, name).not.toContain("font-ming");
      expect(html.replaceAll("sans-serif", ""), name).not.toMatch(/serif/i);
    }
  });

  it("declares no @font-face in the email source tree", () => {
    for (const entry of ["styles.ts", "components", "templates"]) {
      const source = readdirText(join(EMAIL_ROOT, entry));
      expect(source).not.toContain("@font-face");
      expect(source).not.toContain("font-ming");
    }
  });
});

/** Concatenates one file, or every file one directory deep, into a single string. */
function readdirText(target: string): string {
  if (statSync(target).isFile()) return readFileSync(target, "utf8");
  return readdirSync(target)
    .filter((name) => /\.tsx?$/.test(name))
    .map((name) => readFileSync(join(target, name), "utf8"))
    .join("\n");
}
