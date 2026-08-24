import { buildNewsletterConfirmEmail } from "../../emails/templates/newsletter-confirm";

async function main() {
  const message = await buildNewsletterConfirmEmail({
    to: "m.garcia+visual@company.co.uk",
    confirmToken: "visual-confirm-token",
    unsubscribeToken: "visual-unsubscribe-token",
    interests: ["brand-stories", "curated-picks", "mit-trends"],
    locale: "zh-TW",
  });

  process.stdout.write(message.html);
}

void main();
