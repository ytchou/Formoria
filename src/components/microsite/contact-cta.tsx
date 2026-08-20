import { surfaceCardStyles } from "@/components/ui/card";
import type { PublicMicrositeBrand } from "@/lib/brands/contracts";

type ContactCtaProps = {
  siteContent: Pick<PublicMicrositeBrand["siteContent"], "ctaValue">;
};

export function ContactCta({ siteContent }: ContactCtaProps) {
  const email = siteContent.ctaValue;

  return (
    <section
      id="contact"
      className="px-6 py-12 md:px-10 md:py-16"
      aria-labelledby="contact-title"
    >
      <div className="mx-auto max-w-[1280px]">
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
              // The BRAND's accent, as in `hero.tsx` — the label colour is set
              // inline so `type-button`'s own `text-ink` cannot win on source
              // order, and the ring is held off the fill by a ground offset.
              <a
                href={`mailto:${email}`}
                className="inline-flex min-h-11 items-center justify-center rounded-[4px] bg-[var(--brand-accent)] px-6 type-button transition-transform focus-visible:ring-2 focus-visible:ring-[var(--brand-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-ground focus-visible:outline-none active:scale-[0.98] motion-reduce:transition-none"
                style={{ color: "var(--brand-accent-foreground)" }}
              >
                聯絡品牌
              </a>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
