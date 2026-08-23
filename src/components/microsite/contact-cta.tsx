import { MicrositeCta } from "@/components/microsite/microsite-cta";
import { surfaceCardStyles } from "@/components/ui/card";
import { PageShell } from "@/components/ui/page-shell";
import type { PublicMicrositeBrand } from "@/lib/brands/contracts";

type ContactCtaProps = {
  siteContent: Pick<PublicMicrositeBrand["siteContent"], "ctaValue">;
};

export function ContactCta({ siteContent }: ContactCtaProps) {
  const email = siteContent.ctaValue;

  return (
    <section
      id="contact"
      className="py-12 md:py-16"
      aria-labelledby="contact-title"
    >
      {/* Gutter and measure both from the shell — see `hero.tsx`. */}
      <PageShell measure="page">
        <div
          className={surfaceCardStyles({ className: "md:p-8", padding: "lg" })}
        >
          <div className="flex flex-col items-start gap-gutter md:flex-row md:items-center md:justify-between">
            <div className="space-y-2">
              <h2 id="contact-title" className="type-section">
                與品牌聯繫
              </h2>
              <p className="type-body">歡迎洽詢商品、合作與客製需求。</p>
            </div>
            {email && (
              <MicrositeCta href={`mailto:${email}`}>聯絡品牌</MicrositeCta>
            )}
          </div>
        </div>
      </PageShell>
    </section>
  );
}
